// End-to-end against a real production server: health, input validation, the
// one-run lock, attaching to a running investigation, recovering from a
// dropped stream, and replaying the proof over HTTP.
// Builds into .next-test so it never disturbs a running dev server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { isolatedStorage } from './helpers.mts';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const storage = isolatedStorage('e2e');
// Empty values win over .env.local (Next never overrides set variables), keeping the test offline and hermetic.
const env = { ...process.env, NVIDIA_API_KEY: '', ZETARIS_API_TOKEN: '', ZETARIS_ORG_ID: '', BRIGHTDATA_API_TOKEN: '', NEXT_DIST_DIR: '.next-test', NEXT_TELEMETRY_DISABLED: '1', METERLESS_STORAGE_DIR: storage, DEMO_PACING_MS: '120', PORT: String(PORT) };
execSync('npx next build', { env, stdio: 'ignore' });
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { env, stdio: 'ignore', detached: true });
test.after(() => {
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {}
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).status) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const json = (path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function poll(runId: string) {
  const events: any[] = [];
  for (let i = 0; i < 600; i++) {
    const r = await (await fetch(`${BASE}/api/investigate?run=${runId}&from=${events.length}`)).json();
    events.push(...r.events);
    if (r.done) return events;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('run did not finish');
}

test('pages and health respond', async () => {
  assert.equal((await fetch(`${BASE}/`)).status, 200);
  assert.equal((await fetch(`${BASE}/app`)).status, 200);
  const h = await fetch(`${BASE}/api/health`);
  assert.equal(h.status, 200);
  const body = await h.json();
  assert.equal(body.checks.queryEngine.ok, true);
  assert.equal(body.checks.storage.ok, true);
});

test('bad input is rejected with 4xx, not a crash', async () => {
  assert.equal((await json('/api/investigate', { scenario: 'bogus' })).status, 400);
  assert.equal((await json('/api/quarantine', {})).status, 400);
  assert.equal((await json('/api/verify', { evidence: 'nope' })).status, 400);
  assert.equal((await json('/api/vision', { image: 'not-a-data-url' })).status, 400);
  assert.equal((await fetch(`${BASE}/api/investigate?run=does-not-exist`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/signals?scenario=bogus`)).status, 400);
});

test('one run at a time: a second start gets 409 and can attach; reset is refused mid-run', async () => {
  const first = await json('/api/investigate', { scenario: 'reference' });
  assert.equal(first.status, 200);
  const runId = first.headers.get('x-run-id')!;
  const second = await json('/api/investigate', { scenario: 'firmware' });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).runId, runId);
  assert.equal((await json('/api/reset', {})).status, 409);
  await first.body!.cancel(); // drop the stream; the run must carry on
  const events = await poll(runId);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.find((e) => e.type === 'reveal').data.correct, true);
});

test('a stream dropped mid-run is recovered from the event log, and the proof replays over HTTP', async () => {
  const res = await json('/api/investigate', { scenario: 'two-causes' });
  const runId = res.headers.get('x-run-id')!;
  const reader = res.body!.getReader();
  await reader.read(); // receive the first chunk, then vanish
  await reader.cancel();
  const events = await poll(runId);
  const reveal = events.find((e) => e.type === 'reveal').data;
  assert.equal(reveal.correct, true);
  assert.equal(reveal.found.length, 2);
  const evidence = events.find((e) => e.type === 'done').evidence;
  const v = await (await json('/api/verify', { evidence, scenario: 'two-causes' })).json();
  assert.equal(v.ok, true);
  assert.equal(v.root, events.find((e) => e.type === 'ledger').root);
});
