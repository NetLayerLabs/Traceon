// Regression tests for the end-to-end audit (Oct 25): every finding that was
// fixed has a test here, so it cannot quietly come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collect, isolatedStorage, offline } from './helpers.mts';

const storage = isolatedStorage('hardening');
offline();
delete process.env.NVIDIA_API_KEY;
delete process.env.ZETARIS_API_URL;

const { assertReadOnlySelect } = await import('../src/lib/zetaris.ts');
const { verifyLedger } = await import('../src/lib/actions.ts');
const { runInvestigation } = await import('../src/lib/investigation.ts');
const { resolveScenario, getEnterpriseMesh } = await import('../src/lib/enterpriseData.ts');
const { validateMapping, saveDataset, buildCustomMesh } = await import('../src/lib/datasets.ts');
const { resetMeterless } = await import('../src/lib/meterless.ts');
const { getVisionFinding } = await import('../src/lib/vision.ts');

test('only plain read-only SELECT statements can run', () => {
  for (const sql of [
    "SELECT * INTO TXT('/tmp/x') FROM warehouses",
    'UPDATE unit_fact SET failed = 0',
    'DELETE FROM erp_holds',
    'SELECT 1; DROP TABLE unit_fact',
    "SELECT * FROM TXT('/etc/hosts')",
    "SELECT * FROM CSV('/etc/passwd')",
  ]) assert.throws(() => assertReadOnlySelect(sql), undefined, sql);
  // Keywords inside string literals are data, not statements.
  assert.doesNotThrow(() => assertReadOnlySelect("SELECT COUNT(*) AS n FROM unit_fact WHERE region = 'DELETE INTO'"));
  assert.doesNotThrow(() => assertReadOnlySelect('SELECT cell_batch AS grp, COUNT(*) AS units, SUM(failed) AS failures\nFROM unit_fact\nGROUP BY cell_batch'));
});

test('a replayed bundle cannot write files or change data, and a forged summary breaks the chain', async () => {
  const target = path.join(storage, 'pwned.txt');
  const forged = [{ id: 'E-01', kind: 'sql', label: 'x', summary: 'x', proofHash: 'x', chainHash: 'x', query: { sql: `SELECT * INTO TXT('${target}') FROM warehouses`, sourceSilos: [] } }];
  const v = await verifyLedger(forged as never, 'reference');
  assert.equal(v.ok, false);
  assert.equal(fs.existsSync(target), false);

  const ref = await collect((emit) => runInvestigation(emit, { scenarioId: 'reference', pacingMs: 0, vision: null }));
  const evidence = ref.one('done').evidence;
  assert.equal((await verifyLedger(evidence, 'reference')).ok, true);
  const tampered = evidence.map((e: any) => (e.label === 'H-HEAT | H-BATCH' ? { ...e, summary: e.summary.replace('p = 0.23', 'p = 1e-9') } : e));
  assert.equal((await verifyLedger(tampered, 'reference')).ok, false, 'the summary people read is part of the chain');
});

test('uploads: injection-capable values, single suspects and duplicate serials are refused', () => {
  const cols = ['serial', 'lot', 'line', 'failed'];
  const rows = Array.from({ length: 40 }, (_, i) => [`S${i}`, i % 2 ? 'A' : 'B', `L${i % 3}`, i < 6 ? 'yes' : 'no']);
  const m = { outcome: 'failed', failValues: ['yes'], factors: ['lot', 'line'], serial: 'serial' };
  assert.equal(validateMapping(cols, rows, m), null);
  assert.match(validateMapping(cols, rows.map((r, i) => (i === 3 ? [r[0], "x\\' OR 1=1 --", r[2], r[3]] : r)), m)!, /backslash/);
  assert.match(validateMapping(cols, rows, { ...m, factors: ['lot'] })!, /at least two/);
  assert.match(validateMapping(cols, rows, { ...m, factors: ['lot', 'failed'] })!, /outcome column/);
  assert.match(validateMapping(cols, rows.map((r, i) => (i === 5 ? ['S1', ...r.slice(1)] : r)), m)!, /more than once/);
  assert.equal(validateMapping(cols, rows, { ...m, failValues: 'yes' } as never), 'Malformed mapping');
});

test('uploads: dates are used only when they parse; the id covers every row', () => {
  const cols = ['lot', 'line', 'failed', 'when'];
  const rows = Array.from({ length: 60 }, (_, i) => [i % 2 ? 'A' : 'B', `L${i % 3}`, i < 8 ? 'yes' : 'no', i < 8 ? '03/04/2026' : '']);
  const m = { outcome: 'failed', failValues: ['yes'], factors: ['lot', 'line'], date: 'when' };
  const a = saveDataset('a', cols, rows, m);
  assert.equal(buildCustomMesh(a, resolveScenario(a.id)).capabilities.dates, false);
  const changed = rows.map((r, i) => (i === 55 ? ['A', 'L9', 'no', ''] : r));
  assert.notEqual(saveDataset('b', cols, changed, m).id, a.id, 'a change after row 50 gives a new id');
});

test('scenario ids: impossible dates, padded seeds and empty cutoffs are refused', async () => {
  assert.throws(() => resolveScenario('reference@2026-02-31'));
  assert.throws(() => resolveScenario('reference@0000-01-01'));
  assert.throws(() => resolveScenario('random-007'));
  assert.throws(() => resolveScenario('random-1000000'));
  assert.equal(resolveScenario('random-7').id, 'random-7');
  assert.equal(getEnterpriseMesh('reference@2026-01-01').units.length, 0);
  await assert.rejects(collect((emit) => runInvestigation(emit, { scenarioId: 'reference@2026-01-01', pacingMs: 0 })), /nothing to investigate/);
});

test('reset clears demo memory but keeps shared cases, datasets and the signing key', () => {
  for (const d of ['cases', 'datasets', 'proof', 'hmem']) fs.mkdirSync(path.join(storage, d), { recursive: true });
  fs.writeFileSync(path.join(storage, 'cases', 'keep.json'), '{}');
  fs.writeFileSync(path.join(storage, 'proof', 'signing-key.json'), '{}');
  resetMeterless();
  assert.ok(fs.existsSync(path.join(storage, 'cases', 'keep.json')));
  assert.ok(fs.existsSync(path.join(storage, 'proof', 'signing-key.json')));
  assert.ok(fs.existsSync(path.join(storage, 'datasets')));
  assert.equal(fs.existsSync(path.join(storage, 'hmem')), false);
});

test('a photo finding is accepted only by the id the server issued', () => {
  assert.equal(getVisionFinding('forged'), null);
  assert.equal(getVisionFinding({ live: true }), null);
});
