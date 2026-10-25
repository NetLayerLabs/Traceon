// Replayable proof: every query re-executes to the same hash; any tampering is
// caught. Remediation is idempotent and becomes memory the next run recalls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, isolatedStorage, offline } from './helpers.mts';

isolatedStorage('proof');
offline();
const { runInvestigation } = await import('../src/lib/investigation.ts');
const { verifyLedger, executeRemediation } = await import('../src/lib/actions.ts');
const run = (scenarioId: string) => collect((emit) => runInvestigation(emit, { scenarioId, pacingMs: 0, vision: null }));

const ref = await run('reference');
const evidence = ref.one('done').evidence;
const root = ref.one('ledger').root;

test('replay re-executes every query and reproduces the chain root', async () => {
  const v = await verifyLedger(evidence, 'reference');
  assert.equal(v.ok, true);
  assert.equal(v.root, root);
  assert.ok(v.replayedQueries >= 30, `replayed ${v.replayedQueries}`);
});

test('a tampered query is detected', async () => {
  const forged = structuredClone(evidence);
  const i = forged.findIndex((e: any) => e.query?.sql.includes('GROUP BY firmware'));
  forged[i].query.sql = forged[i].query.sql.replace('FROM unit_fact', "FROM unit_fact WHERE carrier = 'UPS'");
  const v = await verifyLedger(forged, 'reference');
  assert.equal(v.ok, false);
  assert.ok(v.mismatches.some((m: any) => m.id === forged[i].id));
});

test('reordering or dropping evidence breaks the chain', async () => {
  const swapped = structuredClone(evidence);
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  assert.equal((await verifyLedger(swapped, 'reference')).ok, false);
  assert.equal((await verifyLedger(evidence.slice(1), 'reference')).ok, false);
});

test('a ledger from one scenario does not verify against another', async () => {
  assert.equal((await verifyLedger(evidence, 'firmware')).ok, false);
});

test('remediation holds exact serials, is idempotent, and is recalled next run', async () => {
  const causes = ref.one('action').plan.causes.map((c: any) => ({ column: c.column, group: c.group, remedy: c.remedy }));
  const first = await executeRemediation({ scenario: 'reference', causes, approvedBy: 'test', ledgerRoot: root });
  assert.equal(first.unitsHeld, 1380);
  assert.equal(first.erpHoldRowCount, 1380);
  assert.equal(first.alreadyQuarantined, false);
  assert.ok(first.notices.distributor.includes('SN-88400 through SN-89779'));
  assert.ok(first.notices.regulator.includes('Section 15(b)'));
  const again = await executeRemediation({ scenario: 'reference', causes, approvedBy: 'test', ledgerRoot: root });
  assert.equal(again.alreadyQuarantined, true);
  assert.equal(again.erpHoldRowCount, 1380, 'no duplicate holds');
  const next = await run('reference');
  assert.ok(next.one('convergence').data.priorInsights.length >= 1, 'H-MEM recalls the approved finding');
});

test('remediation rejects non-actionable columns (no SQL injection path)', async () => {
  await assert.rejects(executeRemediation({ scenario: 'reference', causes: [{ column: 'serial; DROP TABLE unit_fact', group: 'x', remedy: 'QUARANTINE' }], approvedBy: 't', ledgerRoot: root }));
  const quoted = await executeRemediation({ scenario: 'reference', causes: [{ column: 'carrier', group: "x' OR '1'='1", remedy: 'CARRIER_INSPECTION' }], approvedBy: 't', ledgerRoot: root });
  assert.equal(quoted.otherActions[0].units, 0, 'quoted value matches nothing');
});
