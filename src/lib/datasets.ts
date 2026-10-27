// Bring your own data: an uploaded CSV becomes a scenario the agent can
// investigate. One row per unit, an outcome column saying which units failed,
// and any number of categorical factor columns (supplier, plant, firmware...).
// Optional columns enable more of the investigation: a date per failure
// (early-warning replay), a symptom text (failure-signature check), days in
// field (exposure-time check) and a serial number (exact-unit scope).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DimensionSpec, EnterpriseMesh, Scenario, UnitFact, WarrantyClaim } from './enterpriseData';
import { singleton } from './singleton';

export interface DatasetMapping {
  outcome: string; // column holding the failure flag
  failValues: string[]; // values that mean "failed" (case-insensitive)
  factors: string[]; // categorical columns to test as suspects
  serial?: string;
  date?: string; // failure / claim date, YYYY-MM-DD
  symptom?: string;
  daysInField?: string;
  /** Cost of holding one unit (logistics, replacement, handling); the demo uses $25. */
  unitCost?: number;
}

export interface StoredDataset {
  id: string;
  name: string;
  createdAt: string;
  columns: string[];
  rows: string[][];
  mapping: DatasetMapping;
}

export const LIMITS = { maxRows: 400_000, maxFactors: 12, maxGroups: 500, maxBytes: 25_000_000, maxDatasets: 50, inMemory: 2 } as const;

/**
 * The bundled samples exactly as the /data page sends them (default mapping,
 * $25 a unit), and the Backblaze mapping of README Example 3. When the server
 * is full, the oldest other upload makes room; these are never removed.
 */
export const SAMPLE_IDS: ReadonlySet<string> = new Set(['custom-c98e9bfa56fc', 'custom-8c62547c3ba8', 'custom-b5d9aefb1621']);

const dir = () => path.join(process.env.METERLESS_STORAGE_DIR || (process.env.VERCEL ? '/tmp/meterless-data' : path.join(process.cwd(), '.meterless-data')), 'datasets');
const store = singleton('datasets', () => new Map<string, StoredDataset>());

/**
 * RFC 4180-style CSV parser: quoted fields, escaped quotes, CRLF. A quote only
 * opens a quoted field at the start of the field; anywhere else it is a plain
 * character (an inch mark: 5" display). A quote never closed is an error.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let quoteLine = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
      quoteLine = line;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new Error(`Unclosed quote starting on line ${quoteLine}`);
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
  }
  return rows;
}

/** A quick profile of each column, used by the mapping screen. */
export function profile(columns: string[], rows: string[][]) {
  return columns.map((name, c) => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r[c] ?? '', (counts.get(r[c] ?? '') ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { name, distinct: counts.size, top };
  });
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'col';

/** Safe SQL column name for an uploaded factor. */
export const factorColumn = (name: string) => `f_${slug(name)}`;

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
/** Dates drive the early-warning replay; they are used only if at least this share of failures has a valid one. */
const DATES_USABLE = 0.8;

export function validateMapping(columns: string[], rows: string[][], m: DatasetMapping): string | null {
  const has = (c?: string) => !c || columns.includes(c);
  const str = (x: unknown) => typeof x === 'string';
  if (!m || !str(m.outcome) || !Array.isArray(m.failValues) || !Array.isArray(m.factors) || ![...m.failValues, ...m.factors].every(str)) return 'Malformed mapping';
  if (![m.serial, m.date, m.symptom, m.daysInField].every((x) => x === undefined || str(x))) return 'Malformed mapping';
  if (!columns.includes(m.outcome)) return `Outcome column "${m.outcome}" not found`;
  if (!m.failValues.length) return 'Choose which outcome values mean "failed"';
  // One suspect alone cannot be checked for confounding or subgroup consistency.
  if (m.factors.length < 2) return 'Choose at least two suspect columns, so each can be checked against the others';
  if (m.factors.includes(m.outcome)) return 'The outcome column cannot also be a suspect';
  if (m.factors.length > LIMITS.maxFactors) return `At most ${LIMITS.maxFactors} factor columns`;
  for (const f of m.factors) if (!columns.includes(f)) return `Factor column "${f}" not found`;
  if (new Set(m.factors.map(factorColumn)).size !== m.factors.length) return 'Two factor columns have names that collide; rename one';
  if (![m.serial, m.date, m.symptom, m.daysInField].every(has)) return 'An optional column was not found';
  if (m.unitCost !== undefined && !(Number.isFinite(m.unitCost) && m.unitCost >= 0 && m.unitCost <= 1e6)) return 'Cost per unit must be between 0 and 1,000,000';
  if (rows.length > LIMITS.maxRows) return `At most ${LIMITS.maxRows.toLocaleString('en-US')} rows`;
  const fails = new Set(m.failValues.map((v) => v.trim().toLowerCase()));
  const oc = columns.indexOf(m.outcome);
  const failed = rows.filter((r) => fails.has((r[oc] ?? '').trim().toLowerCase())).length;
  if (failed < 3) return 'Need at least 3 failed units';
  if (failed === rows.length) return 'Every unit failed; there is nothing to compare against';
  for (const f of m.factors) {
    const c = columns.indexOf(f);
    const distinct = new Set(rows.map((r) => r[c])).size;
    if (distinct < 2) return `Factor "${f}" has only one value`;
    // alasql reads \' as an escaped quote; a backslash in a value could break out of a SQL literal.
    const bad = rows.find((r) => /[\\\u0000-\u001f]/.test(r[c] ?? ''));
    if (bad) return `Factor "${f}" has a value with a backslash or control character (${JSON.stringify(String(bad[c]).slice(0, 30))}); clean it and upload again`;
    if (distinct > LIMITS.maxGroups) return `Factor "${f}" has ${distinct} values; categorical factors need at most ${LIMITS.maxGroups}`;
  }
  if (m.serial) {
    const sc = columns.indexOf(m.serial);
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r[sc])) return `Serial "${String(r[sc]).slice(0, 30)}" appears more than once; one row per unit`;
      seen.add(r[sc]);
    }
  }
  if (m.date) {
    // Refused here rather than dropped later: without usable dates the early-warning replay silently disappears.
    const dc = columns.indexOf(m.date);
    const failedRows = rows.filter((r) => fails.has((r[oc] ?? '').trim().toLowerCase()));
    const bad = failedRows.filter((r) => !isDate((r[dc] ?? '').slice(0, 10)));
    if ((failedRows.length - bad.length) / failedRows.length < DATES_USABLE)
      return `Failure date: ${bad.length.toLocaleString('en-US')} of ${failedRows.length.toLocaleString('en-US')} failures have no YYYY-MM-DD date (for example ${JSON.stringify(String(bad[0][dc] ?? '').slice(0, 20))}); convert them, or set the date column to none`;
  }
  return null;
}

/** `keep`: ids that must not be removed to make room (the dataset an investigation is running on). */
export function saveDataset(name: string, columns: string[], rows: string[][], mapping: DatasetMapping, keep: string[] = []): StoredDataset {
  // Content address over every row: the same upload gets the same id, and any change gets a new one.
  const h = crypto.createHash('sha256').update(JSON.stringify([columns, mapping]));
  for (const r of rows) h.update(JSON.stringify(r));
  const id = `custom-${h.digest('hex').slice(0, 12)}`;
  const existing = getDataset(id);
  if (existing) return existing;
  makeRoom(new Set([...SAMPLE_IDS, ...keep]));
  const ds: StoredDataset = { id, name: name.slice(0, 80) || 'Uploaded data', createdAt: new Date().toISOString(), columns, rows, mapping };
  remember(ds);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify(ds));
    fs.writeFileSync(path.join(dir(), `${id}.meta.json`), JSON.stringify(meta(ds)));
  } catch {
    // A read-only filesystem keeps the dataset in memory only.
  }
  return ds;
}

const meta = (d: StoredDataset) => ({ id: d.id, name: d.name, createdAt: d.createdAt, rows: d.rows.length, factors: d.mapping.factors });

/** At the cap, remove the oldest uploads (never one in `keep`) so a new one fits: uploads never lock up. */
function makeRoom(keep: Set<string>) {
  const all = listDatasets(); // newest first
  let excess = all.length - LIMITS.maxDatasets + 1;
  for (const d of all.filter((x) => !keep.has(x.id)).reverse()) {
    if (excess-- <= 0) break;
    store.delete(d.id);
    try {
      for (const f of [`${d.id}.json`, `${d.id}.meta.json`]) fs.rmSync(path.join(dir(), f), { force: true });
    } catch {
      // Read-only storage: nothing was written there to remove.
    }
  }
}

/** Keep only a few full datasets in memory; the rest stay on disk. */
function remember(ds: StoredDataset) {
  store.delete(ds.id);
  store.set(ds.id, ds);
  while (store.size > LIMITS.inMemory) store.delete(store.keys().next().value!);
}

export function getDataset(id: string): StoredDataset | null {
  if (!/^custom-[a-f0-9]{12}$/.test(id)) return null;
  const hit = store.get(id);
  if (hit) return hit;
  try {
    const ds = JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf-8')) as StoredDataset;
    remember(ds);
    return ds;
  } catch {
    return null;
  }
}

export function listDatasets() {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => /^custom-[a-f0-9]{12}\.json$/.test(f))
      .map((f) => {
        const id = f.replace('.json', '');
        try {
          return JSON.parse(fs.readFileSync(path.join(dir(), `${id}.meta.json`), 'utf-8')) as ReturnType<typeof meta>;
        } catch {
          const d = getDataset(id); // written before the metadata index existed
          return d ? meta(d) : null;
        }
      })
      .filter((d): d is ReturnType<typeof meta> => Boolean(d))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** Build the tables the agent queries from an uploaded dataset. */
export function buildCustomMesh(ds: StoredDataset, scenario: Scenario): EnterpriseMesh {
  const m = ds.mapping;
  const idx = (c?: string) => (c ? ds.columns.indexOf(c) : -1);
  const oc = idx(m.outcome);
  const sc = idx(m.serial);
  const dc = idx(m.date);
  const yc = idx(m.symptom);
  const fc = idx(m.daysInField);
  const fails = new Set(m.failValues.map((v) => v.trim().toLowerCase()));
  const factorIdx = m.factors.map((f) => ({ name: f, col: factorColumn(f), i: idx(f) }));
  const failedRows = ds.rows.filter((r) => fails.has((r[oc] ?? '').trim().toLowerCase()));
  // Dates drive the early-warning replay; use them only if most failures have a valid one.
  const datesUsable = dc >= 0 && failedRows.length > 0 && failedRows.filter((r) => isDate((r[dc] ?? '').slice(0, 10))).length / failedRows.length >= DATES_USABLE;
  const dates = datesUsable ? ds.rows.map((r) => (r[dc] ?? '').slice(0, 10)).filter(isDate).sort() : [];
  // Without usable dates, the upload day stands in, so the same dataset always gives the same tables.
  const asOf = dates[dates.length - 1] ?? ds.createdAt.slice(0, 10);

  const units: UnitFact[] = [];
  const claims: WarrantyClaim[] = [];
  ds.rows.forEach((r, n) => {
    const failed = fails.has((r[oc] ?? '').trim().toLowerCase()) ? 1 : 0;
    const serial = sc >= 0 && r[sc] ? String(r[sc]) : `U-${n + 1}`;
    const u: Record<string, unknown> = { serial, failed };
    for (const f of factorIdx) u[f.col] = r[f.i] === '' || r[f.i] === undefined ? '(blank)' : r[f.i];
    if (fc >= 0) u.days_in_field = Number(r[fc]) || 0;
    units.push(u as unknown as UnitFact);
    if (failed) {
      const date = datesUsable && isDate((r[dc] ?? '').slice(0, 10)) ? r[dc].slice(0, 10) : asOf;
      const symptom = yc >= 0 ? String(r[yc] ?? '') : '';
      claims.push({ claim_id: `C-${n + 1}`, serial, lot_id: '', filed_date: date, region: '', symptom, severity: 'OVERHEAT', narrative: symptom || 'Failure recorded in uploaded data' });
    }
  });
  claims.sort((a, b) => a.filed_date.localeCompare(b.filed_date) || a.claim_id.localeCompare(b.claim_id));
  const used = new Set<string>();
  const dimensions: DimensionSpec[] = factorIdx.map((f, i) => ({
    id: (() => {
      let id = `H-${f.col.slice(2).toUpperCase().slice(0, 14)}`;
      if (used.has(id)) id = `${id}-${i + 1}`;
      used.add(id);
      return id;
    })(),
    column: f.col,
    title: f.name,
    claim: `Failures concentrate in one value of "${f.name}"`,
    silo: 'Uploaded data',
  }));
  return {
    scenario,
    lots: [],
    bom: [],
    units,
    claims,
    warehouses: [],
    asOf,
    dimensions,
    custom: true,
    unitCost: m.unitCost,
    capabilities: { dates: datesUsable, symptoms: yc >= 0, daysInField: fc >= 0, warehouses: false, lineage: false },
  };
}
