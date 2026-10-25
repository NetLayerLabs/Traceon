// Every external dependency failing must degrade cleanly: feeds report
// "unreachable", Nemotron falls back to labeled templates within its timeout,
// Zetaris falls back to the mirror with a recorded reason, and the verdict is
// unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { collect, isolatedStorage } from './helpers.mts';

isolatedStorage('degrade');
// A server that accepts connections and never answers: the worst case for timeouts.
const hang = http.createServer(() => {});
await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
const port = (hang.address() as { port: number }).port;
process.env.NVIDIA_API_KEY = 'nvapi-test-key';
process.env.NEMOTRON_TIMEOUT_MS = '500';
process.env.NVIDIA_NIM_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.ZETARIS_API_URL = 'http://127.0.0.1:9'; // nothing listens on port 9
process.env.ZETARIS_ORG_ID = '1';
process.env.ZETARIS_API_TOKEN = 'x';
// Federal feeds and Bright Data: hard failure.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('127.0.0.1')) return realFetch(input, init);
  throw new Error('network disabled in tests');
}) as typeof fetch;

const { nemotronChat } = await import('../src/lib/nemotron.ts');
const { analyzeDefectPhoto } = await import('../src/lib/vision.ts');
const { fetchAllFeeds } = await import('../src/lib/signals.ts');
const { runInvestigation, numberGuard } = await import('../src/lib/investigation.ts');

test.after(() => hang.close());

test('a hanging Nemotron endpoint times out and reports offline', async () => {
  const t = Date.now();
  const r = await nemotronChat({ user: 'hi', timeoutMs: 400 });
  assert.equal(r.live, false);
  assert.ok(r.error);
  assert.ok(Date.now() - t < 3000, 'returned promptly');
});

test('vision falls back to the labeled reference analysis', async () => {
  const v = await analyzeDefectPhoto('data:image/png;base64,AAAA', 'test');
  assert.equal(v.live, false);
  assert.match(v.model, /offline/);
});

test('unreachable feeds are reported, never faked', async () => {
  const feeds = await fetchAllFeeds('reference');
  for (const f of feeds.filter((x) => ['CPSC SaferProducts', 'openFDA MAUDE', 'NHTSA ODI'].includes(x.feed))) {
    assert.equal(f.status, 'unreachable');
    assert.equal(f.items.length, 0);
  }
});

test('with every dependency down, the investigation still reaches the right verdict', async () => {
  const r = await collect((emit) => runInvestigation(emit, { scenarioId: 'reference', pacingMs: 0, vision: null }));
  assert.equal(r.one('reveal').data.correct, true);
  assert.equal(r.one('gate').pass, true);
  assert.equal(r.one('plan').source, 'catalog');
  assert.equal(r.one('narrative').source, 'template');
  const queries = r.one('done').evidence.filter((e: any) => e.query);
  assert.ok(queries.every((e: any) => e.query.executedVia === 'LOCAL_FEDERATED_MIRROR'));
  assert.ok(queries.every((e: any) => e.query.fallbackReason), 'every fallback records why');
});

test('the number guard flags figures that are not in the evidence', () => {
  const g = numberGuard('Traceon found 116 incidents and saved $9,999,999 across 1,380 units.', { incidents: 116, units: 1380 });
  assert.deepEqual(g.unverified, ['9,999,999']);
  assert.equal(g.verified, 2);
});
