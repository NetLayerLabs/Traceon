// Run registry hardening: one investigation at a time, and a watchdog that
// ends a hung run and releases the lock once that run has actually stopped.
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
const waitSettled = async (id: string) => {
  for (let i = 0; i < 800; i++) {
    if (getRun(id)?.settled) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('run never settled');
};

test('a second investigation is rejected while one runs', async () => {
  const run = startRun('reference', null);
  assert.throws(() => startRun('firmware', null), (e: unknown) => e instanceof BusyError && e.run.id === run.id);
  await waitSettled(run.id);
});

test('the watchdog ends a run that exceeds its budget and frees the lock', async () => {
  const run = startRun('reference', null);
  const done = await waitDone(run.id);
  const types = done.events.map((e) => e.type);
  assert.ok(types.includes('error'));
  assert.equal(types.at(-1), 'done');
  assert.match((done.events.find((e) => e.type === 'error') as { message: string }).message, /timed out/);
  // The timed-out run may still be writing memory, so the lock is held until it stops.
  assert.equal(activeRun()?.id, run.id);
  assert.throws(() => startRun('firmware', null), (e: unknown) => e instanceof BusyError);
  const count = done.events.length;
  await waitSettled(run.id);
  // Late events from the abandoned run are ignored, and then a new run can start.
  assert.equal(getRun(run.id)!.events.length, count);
  assert.equal(activeRun(), null);
  const next = startRun('noise', null);
  assert.ok(next.id);
  await waitSettled(next.id);
});
