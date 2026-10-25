// Exports the simulated enterprise silos as CSV files to load into Zetaris
// (as file-store tables or via a connected data source). Usage:
//   npm run zetaris:export   -> exports/zetaris/<table>.csv
import fs from 'node:fs';
import path from 'node:path';
import { getEnterpriseMesh } from '../src/lib/enterpriseData.ts';

const out = path.join(process.cwd(), 'exports', 'zetaris');
fs.mkdirSync(out, { recursive: true });
const mesh = getEnterpriseMesh();
const tables: Record<string, Record<string, unknown>[]> = {
  erp_production_lots: mesh.lots as unknown as Record<string, unknown>[],
  supplier_bom_lineage: mesh.bom as unknown as Record<string, unknown>[],
  unit_fact: mesh.units as unknown as Record<string, unknown>[],
  warranty_claims: mesh.claims as unknown as Record<string, unknown>[],
  warehouses: mesh.warehouses as unknown as Record<string, unknown>[],
};
const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
for (const [name, rows] of Object.entries(tables)) {
  const cols = Object.keys(rows[0]);
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(out, `${name}.csv`), body);
  console.log(`${name}.csv  ${rows.length.toLocaleString('en-US')} rows  ${(body.length / 1e6).toFixed(1)} MB  columns: ${cols.join(', ')}`);
}
console.log(`\nWrote ${out}`);
