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
}

export interface StoredDataset {
  id: string;
  name: string;
  createdAt: string;
  columns: string[];
  rows: string[][];
  mapping: DatasetMapping;
}

export const LIMITS = { maxRows: 250_000, maxFactors: 12, maxGroups: 500, maxBytes: 25_000_000 } as const;

const dir = () => path.join(process.env.METERLESS_STORAGE_DIR || (process.env.VERCEL ? '/tmp/meterless-data' : path.join(process.cwd(), '.meterless-data')), 'datasets');
const store = singleton('datasets', () => new Map<string, StoredDataset>());

/** RFC 4180-style CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
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

export function validateMapping(columns: string[], rows: string[][], m: DatasetMapping): string | null {
  const has = (c?: string) => !c || columns.includes(c);
  if (!columns.includes(m.outcome)) return `Outcome column "${m.outcome}" not found`;
  if (!m.failValues?.length) return 'Choose which outcome values mean "failed"';
  if (!m.factors?.length) return 'Choose at least one factor column to test';
  if (m.factors.length > LIMITS.maxFactors) return `At most ${LIMITS.maxFactors} factor columns`;
  for (const f of m.factors) if (!columns.includes(f)) return `Factor column "${f}" not found`;
  if (new Set(m.factors.map(factorColumn)).size !== m.factors.length) return 'Two factor columns have names that collide; rename one';
  if (![m.serial, m.date, m.symptom, m.daysInField].every(has)) return 'An optional column was not found';
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
    if (distinct > LIMITS.maxGroups) return `Factor "${f}" has ${distinct} values; categorical factors need at most ${LIMITS.maxGroups}`;
  }
  return null;
}

export function saveDataset(name: string, columns: string[], rows: string[][], mapping: DatasetMapping): StoredDataset {
  const id = `custom-${crypto.createHash('sha256').update(JSON.stringify([columns, mapping, rows.length, rows.slice(0, 50)])).digest('hex').slice(0, 12)}`;
  const ds: StoredDataset = { id, name: name.slice(0, 80) || 'Uploaded data', createdAt: new Date().toISOString(), columns, rows, mapping };
  store.set(id, ds);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify(ds));
  } catch {
    // A read-only filesystem keeps the dataset in memory only.
  }
  return ds;
}

export function getDataset(id: string): StoredDataset | null {
  const hit = store.get(id);
  if (hit) return hit;
  try {
    const ds = JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf-8')) as StoredDataset;
    store.set(id, ds);
    return ds;
  } catch {
    return null;
  }
}

export function listDatasets() {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => f.startsWith('custom-') && f.endsWith('.json'))
      .map((f) => getDataset(f.replace('.json', '')))
      .filter((d): d is StoredDataset => Boolean(d))
      .map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, rows: d.rows.length, factors: d.mapping.factors }));
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
  const dates = dc >= 0 ? ds.rows.map((r) => (r[dc] ?? '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  const asOf = dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);

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
      const date = dc >= 0 && /^\d{4}-\d{2}-\d{2}/.test(r[dc] ?? '') ? r[dc].slice(0, 10) : asOf;
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
    capabilities: { dates: dc >= 0, symptoms: yc >= 0, daysInField: fc >= 0, warehouses: false, lineage: false },
  };
}
