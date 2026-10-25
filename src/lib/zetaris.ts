// Zetaris federation adapter. Every query the agent runs goes through here and
// comes back with a SHA-256 proof hash over (sql + canonical rows), so each
// node in the causal graph can be replayed and verified later.
//
// Cloud path follows the Zetaris SaaS OpenAPI spec
// (https://api.saas.enterprise.zetaris.com/redoc/docs.yaml):
//   POST   /api/v1.0/query/sql/start        {select, pageLimit<=100} -> records, totalPages, queryToken
//   GET    /api/v1.0/query/sql/page         ?queryToken&pageLimit&pageNumber
//   DELETE /api/v1.0/query/sql/close/{queryToken}
//   GET    /api/v1.0/auth/login | /refresh  (Basic / Bearer) -> {idToken, refreshToken}
// Every call carries X-Request-ID (uuid) and X-Org-ID headers.
// If the cloud is not configured or a call fails, the query runs on the local
// federated mirror instead, and the result is labeled with where it ran.
import crypto from 'node:crypto';
import alasql from 'alasql';
import { getEnterpriseMesh } from './enterpriseData';
import { singleton } from './singleton';

export type ExecutedVia = 'ZETARIS_CLOUD' | 'LOCAL_FEDERATED_MIRROR';

export interface FederatedQueryResult {
  queryId: string;
  sql: string;
  cloudSql?: string; // the SQL actually sent to Zetaris, after table mapping
  sourceSilos: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  proofHash: string;
  latencyMs: number;
  executedVia: ExecutedVia;
  fallbackReason?: string;
}

// Silo catalog: which physical system each virtual table lives in.
export const SILO_CATALOG = {
  erp_production_lots: 'SAP S/4 ERP (Plant MES)',
  supplier_bom_lineage: 'Supplier Portal (BOM lineage)',
  unit_fact: 'Zetaris virtual view: ERP x BOM x Telemetry x WMS',
  warranty_claims: 'Salesforce Service Cloud (warranty)',
  warehouses: 'Manhattan WMS',
  erp_holds: 'SAP S/4 ERP (quality holds)',
} as const;

export const MESH_TABLES = ['erp_production_lots', 'supplier_bom_lineage', 'unit_fact', 'warranty_claims', 'warehouses'] as const;

// One in-memory database per scenario. Only the reference scenario is loaded
// into Zetaris, so other scenarios always run on their local mirror.
const mirrors = singleton('mirrors', () => new Map<string, InstanceType<typeof alasql.Database>>());

function mirrorFor(scenarioId: string) {
  const existing = mirrors.get(scenarioId);
  if (existing) return existing;
  const mesh = getEnterpriseMesh(scenarioId);
  const db = new alasql.Database(`traceon_${scenarioId.replace(/[^a-z0-9]/gi, '_')}`);
  const load = (name: string, data: unknown[]) => {
    db.exec(`CREATE TABLE ${name}`);
    (db as unknown as { tables: Record<string, { data: unknown[] }> }).tables[name].data = data;
  };
  load('erp_production_lots', mesh.lots);
  load('supplier_bom_lineage', mesh.bom);
  load('unit_fact', mesh.units);
  load('warranty_claims', mesh.claims);
  load('warehouses', mesh.warehouses);
  load('erp_holds', []);
  mirrors.set(scenarioId, db);
  // Keep memory bounded: at most 3 scenario mirrors; the reference is never evicted.
  for (const id of mirrors.keys()) {
    if (mirrors.size <= 3) break;
    if (id === 'reference' || id === scenarioId) continue;
    mirrors.delete(id);
    delete (alasql as unknown as { databases: Record<string, unknown> }).databases[`traceon_${id.replace(/[^a-z0-9]/gi, '_')}`];
  }
  return db;
}

/**
 * Canonical form for hashing: keys lowercased and sorted, numeric strings and
 * booleans normalized, rows sorted. Cloud GROUP BY order is not guaranteed and
 * Spark may return numbers as strings, so this keeps hashes identical across
 * the cloud and the mirror and across replays.
 */
export function canonicalRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const norm = (v: unknown): unknown => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toFixed(6));
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return norm(Number(v));
    if (v === 'true' || v === 'false') return v === 'true' ? 1 : 0;
    return v ?? null;
  };
  return rows
    .map((r) => Object.fromEntries(Object.keys(r).map((k): [string, unknown] => [k.toLowerCase(), norm(r[k])]).sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function hashRows(sql: string, rows: Record<string, unknown>[]): string {
  return crypto.createHash('sha256').update(sql).update('\u0000').update(JSON.stringify(canonicalRows(rows))).digest('hex');
}

// ---------- Zetaris cloud client ----------
interface CloudConfig {
  baseUrl: string;
  orgId: string;
  apiToken?: string;
  username?: string;
  password?: string;
}

function cloudConfig(): CloudConfig | null {
  const baseUrl = process.env.ZETARIS_API_URL?.replace(/\/+$/, '');
  const orgId = process.env.ZETARIS_ORG_ID;
  const apiToken = process.env.ZETARIS_API_TOKEN || process.env.ZETARIS_ID_TOKEN;
  const username = process.env.ZETARIS_USERNAME;
  const password = process.env.ZETARIS_PASSWORD;
  if (!baseUrl || !orgId || !(apiToken || (username && password))) return null;
  return { baseUrl, orgId, apiToken, username, password };
}

let session: { idToken: string; refreshToken: string; obtainedAt: number } | null = null; // per-bundle cache is fine: it only saves a login

const headers = (cfg: CloudConfig, bearer?: string): Record<string, string> => ({
  'X-Request-ID': crypto.randomUUID(),
  'X-Org-ID': cfg.orgId,
  Accept: 'application/json',
  ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
});

async function bearerToken(cfg: CloudConfig): Promise<string> {
  if (cfg.apiToken) return cfg.apiToken;
  // idTokens are short-lived JWTs; refresh after 45 minutes, re-login if refresh fails.
  if (session && Date.now() - session.obtainedAt < 45 * 60_000) return session.idToken;
  if (session) {
    const r = await fetch(`${cfg.baseUrl}/api/v1.0/auth/refresh`, { headers: headers(cfg, session.refreshToken), signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const t = await r.json();
      session = { idToken: t.idToken, refreshToken: t.refreshToken, obtainedAt: Date.now() };
      return session.idToken;
    }
  }
  const basic = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const r = await fetch(`${cfg.baseUrl}/api/v1.0/auth/login`, {
    headers: { ...headers(cfg), Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Zetaris login ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const t = await r.json();
  session = { idToken: t.idToken, refreshToken: t.refreshToken, obtainedAt: Date.now() };
  return session.idToken;
}

/** Map local table names to their Zetaris names (ZETARIS_SCHEMA prefix and/or ZETARIS_TABLE_MAP JSON). */
export function toCloudSql(sql: string): string {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(process.env.ZETARIS_TABLE_MAP || '{}');
  } catch {
    map = {};
  }
  const schema = process.env.ZETARIS_SCHEMA;
  return sql.replace(new RegExp(`\\b(${MESH_TABLES.join('|')})\\b`, 'g'), (t) => map[t] ?? (schema ? `${schema}.${t}` : t));
}

const PAGE_LIMIT = 100; // API maximum
const MAX_PAGES = 50;

export async function runCloudQuery(sql: string): Promise<Record<string, unknown>[]> {
  const cfg = cloudConfig();
  if (!cfg) throw new Error('Zetaris cloud not configured');
  const token = await bearerToken(cfg);
  const start = await fetch(`${cfg.baseUrl}/api/v1.0/query/sql/start`, {
    method: 'POST',
    headers: { ...headers(cfg, token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ select: sql, pageLimit: PAGE_LIMIT }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!start.ok) throw new Error(`Zetaris start ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const first = await start.json();
  const queryToken: string = first.queryToken;
  const rows: Record<string, unknown>[] = [...(first.records ?? [])];
  try {
    const totalPages = Math.min(Number(first.totalPages ?? 1), MAX_PAGES);
    if (Number(first.totalPages ?? 1) > MAX_PAGES) throw new Error(`result too large (${first.totalCount} rows)`);
    // Page numbering: the first page comes back from /start; detect 0- vs 1-based from it.
    const firstPage = Number(first.pageNumber ?? 1);
    for (let n = firstPage + 1; n < firstPage + totalPages; n++) {
      const qs = new URLSearchParams({ queryToken, pageLimit: String(PAGE_LIMIT), pageNumber: String(n) });
      const page = await fetch(`${cfg.baseUrl}/api/v1.0/query/sql/page?${qs}`, { headers: headers(cfg, token), signal: AbortSignal.timeout(30_000) });
      if (!page.ok) throw new Error(`Zetaris page ${n} ${page.status}: ${(await page.text()).slice(0, 160)}`);
      rows.push(...((await page.json()).records ?? []));
    }
  } finally {
    // Frees the server-side cursor; failure here never fails the query.
    fetch(`${cfg.baseUrl}/api/v1.0/query/sql/close/${encodeURIComponent(queryToken)}`, { method: 'DELETE', headers: headers(cfg, token) }).catch(() => {});
  }
  // Records may arrive as JSON strings ("A list of records in JSON format"), and
  // Spark may stringify numbers/booleans; coerce so "false" is never truthy.
  return rows.map((r) => {
    const obj = (typeof r === 'string' ? JSON.parse(r) : r) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.toLowerCase(),
        v === 'true' ? true : v === 'false' ? false : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v,
      ])
    );
  });
}

let querySeq = 0;

/**
 * Every query the agent runs is a single read-only SELECT. Anything else is
 * refused before it reaches the mirror or Zetaris, because a replayed proof
 * bundle can come from outside (alasql can write files with SELECT INTO).
 */
export function assertReadOnlySelect(sql: string) {
  const code = sql.replace(/'(?:[^']|'')*'/g, "''"); // ignore string literals
  if (!/^\s*SELECT\b/i.test(code)) throw new Error('Only SELECT queries can run');
  if (/[;\\]/.test(code) || /\b(INTO|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|ATTACH|DETACH|USE|REQUIRE|SOURCE|DECLARE|EXEC|EXECUTE)\b/i.test(code) || /\b(TXT|CSV|TSV|TAB|JSON|JSONL|XLSX|XLS|FILE|SQLITE|IDB|LOCALSTORAGE)\s*\(/i.test(code)) {
    throw new Error('Query rejected: only plain read-only SELECT statements can run');
  }
}

export async function runFederatedQuery(sql: string, sourceSilos: string[], scenarioId = 'reference'): Promise<FederatedQueryResult> {
  assertReadOnlySelect(sql);
  const start = performance.now();
  let rows: Record<string, unknown>[] | null = null;
  let executedVia: ExecutedVia = 'ZETARIS_CLOUD';
  let fallbackReason: string | undefined;
  // Only the reference scenario's data is loaded into Zetaris.
  const cloudSql = cloudConfig() && scenarioId === 'reference' ? toCloudSql(sql) : undefined;
  if (cloudConfig() && scenarioId !== 'reference')
    fallbackReason = scenarioId.startsWith('custom-')
      ? 'uploaded data is queried on the local engine; Zetaris holds the reference scenario'
      : `scenario "${scenarioId}" is generated locally; Zetaris holds the reference scenario`;
  if (cloudSql) {
    try {
      rows = await runCloudQuery(cloudSql);
    } catch (err) {
      fallbackReason = (err as Error).message;
    }
  }
  if (!rows) {
    rows = mirrorFor(scenarioId).exec(sql) as Record<string, unknown>[];
    executedVia = 'LOCAL_FEDERATED_MIRROR';
  }
  return {
    queryId: `Q-${String(++querySeq).padStart(3, '0')}`,
    sql,
    cloudSql,
    sourceSilos,
    rows,
    rowCount: rows.length,
    proofHash: hashRows(sql, rows),
    latencyMs: Math.round(performance.now() - start),
    executedVia,
    fallbackReason,
  };
}

/** Local-mirror write (used by the quarantine action). */
export function mirrorExec(scenarioId: string, sql: string, params?: unknown[]): unknown {
  return mirrorFor(scenarioId).exec(sql, params);
}

export function zetarisMode(): ExecutedVia {
  return cloudConfig() ? 'ZETARIS_CLOUD' : 'LOCAL_FEDERATED_MIRROR';
}

/**
 * Parity check: run the same probe queries on Zetaris and on the mirror and
 * compare hashes. Proves the cloud holds the same data the demo reasons over.
 */
export async function zetarisParityCheck() {
  const probes = [
    'SELECT COUNT(*) AS n FROM unit_fact',
    'SELECT cell_batch AS grp, COUNT(*) AS units, SUM(failed) AS failures FROM unit_fact GROUP BY cell_batch',
    'SELECT COUNT(*) AS n FROM warranty_claims',
    'SELECT lot_id, cell_batch FROM supplier_bom_lineage',
  ];
  if (!cloudConfig()) return { configured: false as const, ok: false, probes: [] };
  const db = mirrorFor('reference');
  const results = [];
  for (const sql of probes) {
    const t = performance.now();
    try {
      const cloud = await runCloudQuery(toCloudSql(sql));
      const local = db.exec(sql) as Record<string, unknown>[];
      results.push({ sql, ok: hashRows(sql, cloud) === hashRows(sql, local), cloudRows: cloud.length, localRows: local.length, ms: Math.round(performance.now() - t) });
    } catch (err) {
      results.push({ sql, ok: false, error: (err as Error).message, ms: Math.round(performance.now() - t) });
    }
  }
  return { configured: true as const, ok: results.every((r) => r.ok), probes: results };
}

/** Clears ERP holds in every loaded scenario mirror (demo reset). */
export function resetMirrorHolds() {
  for (const db of mirrors.values()) db.exec('DELETE FROM erp_holds');
}
