// Run registry hardening: one investigation at a time, and a watchdog that
// ends a hung run and releases the lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedStorage, offline } from './helpers.mts';

isolatedStorage('registry');
offline();
process.env.RUN_TIMEOUT_MS = '400';
process.env.DEMO_PACING_MS = '300'; // ~10 paced steps: guaranteed to outlast the watchdog
const { startRun, activeRun, BusyError, getRun } = await import('../src/lib/runRegistry.ts');

const waitDone = async (id: string) => {
  for (let i = 0; i < 200; i++) {
    if (getRun(id)?.finishedAt) return getRun(id)!;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('run never finished');
};

test('a second investigation is rejected while one runs', async () => {
  const run = startRun('reference', null);
  assert.throws(() => startRun('firmware', null), (e: unknown) => e instanceof BusyError && e.run.id === run.id);
  await waitDone(run.id);
});

test('the watchdog ends a run that exceeds its budget and frees the lock', async () => {
  const run = startRun('reference', null);
  const done = await waitDone(run.id);
  const types = done.events.map((e) => e.type);
  assert.ok(types.includes('error'));
  assert.equal(types.at(-1), 'done');
  assert.match((done.events.find((e) => e.type === 'error') as { message: string }).message, /timed out/);
  assert.equal(activeRun(), null);
  // Late events from the abandoned run are ignored, and a new run can start.
  const count = done.events.length;
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(getRun(run.id)!.events.length, count);
  const next = startRun('noise', null);
  assert.ok(next.id);
  await waitDone(next.id);
});
