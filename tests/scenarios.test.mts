// The agent run blind on different hidden causes. It must find exactly the
// planted causes, and block action when there is no cause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, isolatedStorage, offline } from './helpers.mts';

isolatedStorage('scenarios');
offline();
const { runInvestigation } = await import('../src/lib/investigation.ts');
const run = (scenarioId: string) => collect((emit) => runInvestigation(emit, { scenarioId, pacingMs: 0, vision: null }));
const statusOf = (r: Awaited<ReturnType<typeof run>>) => Object.fromEntries(r.of('hypothesis').map((e) => [e.node.id, e.node.status]));

test('reference: finds cell batch CB-B-0917 and unmasks four confounders', async () => {
  const r = await run('reference');
  const s = statusOf(r);
  assert.equal(s['H-BATCH'], 'CONFIRMED');
  for (const id of ['H-HEAT', 'H-PLANT', 'H-BMS', 'H-SUPPLIER']) assert.equal(s[id], 'CONFOUNDED', id);
  for (const id of ['H-FW', 'H-CARRIER']) assert.equal(s[id], 'NO_ASSOCIATION', id);
  assert.equal(r.one('gate').pass, true);
  const plan = r.one('action').plan;
  assert.equal(plan.causes.length, 1);
  assert.equal(plan.causes[0].lots[0].lot_id, 'L-409');
  assert.equal(plan.affectedUnits, 1380);
  assert.equal(plan.savingsUsd, 4_465_500);
  assert.equal(r.one('reveal').data.correct, true);
});

test('firmware bug: confirms firmware v3.4 and clears the batch; heat is a confounder', async () => {
  const r = await run('firmware');
  const s = statusOf(r);
  assert.equal(s['H-FW'], 'CONFIRMED');
  assert.notEqual(s['H-BATCH'], 'CONFIRMED');
  assert.equal(s['H-HEAT'], 'CONFOUNDED');
  const plan = r.one('action').plan;
  assert.equal(plan.causes[0].remedy, 'OTA_ROLLBACK');
  assert.equal(r.one('gate').pass, true);
  assert.equal(r.one('reveal').data.correct, true);
});

test('two causes: finds both the batch and the firmware bug, each with its own remedy', async () => {
  const r = await run('two-causes');
  const found = r.one('reveal').data.found.map((f: any) => `${f.column}=${f.group}`).sort();
  assert.deepEqual(found, ['cell_batch=CB-B-0917', 'firmware=v3.4']);
  assert.deepEqual(r.one('action').plan.causes.map((c: any) => c.remedy).sort(), ['OTA_ROLLBACK', 'QUARANTINE']);
  assert.equal(r.one('gate').pass, true);
});

test('noise only: no cause, the gate blocks, no action is proposed', async () => {
  const r = await run('noise');
  assert.equal(r.of('action').length, 0);
  assert.equal(r.one('gate').pass, false);
  assert.ok(!Object.values(statusOf(r)).includes('CONFIRMED'));
  assert.equal(r.one('narrative').guard.unverified.length, 0);
  assert.equal(r.one('reveal').data.correct, true);
});

test('random hidden scenarios: correct on every seed in 1..40', async () => {
  const wrong: string[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const r = await run(`random-${seed}`);
    const rev = r.one('reveal').data;
    if (!rev.correct) wrong.push(`${seed}: planted ${JSON.stringify(rev.truth)} found ${JSON.stringify(rev.found)}`);
  }
  assert.deepEqual(wrong, []);
});

test('random scenarios hide their description until the reveal', async () => {
  const r = await run('random-7');
  assert.equal(r.one('scenario').blurb, null);
  assert.ok(r.one('reveal').data.blurb.length > 0);
});
