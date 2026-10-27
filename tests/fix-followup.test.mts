// Regression tests for the audit follow-ups that crossed group lines: proof
// bundles replay only server-recorded SQL, POST bodies are size-capped, the
// public health check keeps the storage path to itself, vision takes raster
// photos only, and the case tools cite the exhibit each verdict quotes.
// Offline: no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, isolatedStorage, offline } from './helpers.mts';

const storage = isolatedStorage('fix-followup');
offline();
process.env.DEMO_PACING_MS = '0';
for (const k of ['NVIDIA_API_KEY', 'NIGHTSHIFT_TOKEN', 'NIGHTSHIFT_TOKEN_FILE', 'ZETARIS_API_URL', 'BRIGHTDATA_API_TOKEN']) delete process.env[k];

const { runInvestigation } = await import('../src/lib/investigation.ts');
const { buildCaseView } = await import('../src/lib/caseView.ts');
const { caseFacts } = await import('../src/lib/ask.ts');
const { eightD } = await import('../src/lib/reports.ts');
const { getRun, startRun } = await import('../src/lib/runRegistry.ts');
const { mirrorExec, hashRows } = await import('../src/lib/zetaris.ts');
const verify = await import('../src/app/api/verify/route.ts');
const ask = await import('../src/app/api/ask/route.ts');
const vision = await import('../src/app/api/vision/route.ts');
const health = await import('../src/app/api/health/route.ts');

const post = (route: { POST: (r: Request) => Promise<Response> }, body: unknown) =>
  route.POST(new Request('http://t/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

// A run the server itself recorded, as the UI's bundle export would carry it.
const run = startRun('reference', null);
for (let i = 0; i < 2000 && !getRun(run.id)?.settled; i++) await new Promise((r) => setTimeout(r, 25));
const recorded = buildCaseView(getRun(run.id)!.events);

test('a bundle of a recorded run replays; SQL the server did not record is never executed', async () => {
  const ok = await (await post(verify, { evidence: recorded.evidence, scenario: 'reference' })).json();
  assert.equal(ok.ok, true);
  assert.equal(ok.root, recorded.ledger!.root);
  assert.ok(ok.replayedQueries >= 30);

  // An equivalent query with its own matching hash: executing it would "match",
  // so a mismatch here shows it was not run.
  const forged = structuredClone(recorded.evidence);
  const i = forged.findIndex((e) => e.query?.sql.includes('GROUP BY firmware'));
  const sql = `${forged[i].query!.sql}\n`;
  forged[i].query!.sql = sql;
  forged[i].proofHash = hashRows(sql, mirrorExec('reference', sql) as Record<string, unknown>[]);
  const v = await (await post(verify, { evidence: forged, scenario: 'reference', ledgerRoot: recorded.ledger!.root })).json();
  const r = v.results.find((x: { id: string }) => x.id === forged[i].id);
  assert.equal(r.replayed, false);
  assert.equal(r.match, false);
  assert.equal(v.ok, false);
  assert.equal(v.replayedQueries, ok.replayedQueries - 1);
});

test('a bundle this server has no record of is refused without replaying anything', async () => {
  const other = await collect((emit) => runInvestigation(emit, { scenarioId: 'firmware', pacingMs: 0, vision: null }));
  const res = await post(verify, { evidence: other.one('done').evidence, scenario: 'firmware' });
  assert.equal(res.status, 404);
  const heavy = [{ id: 'E-01', kind: 'sql', label: 'x', summary: 'x', proofHash: 'x', chainHash: 'x', query: { sql: 'SELECT a.serial FROM unit_fact a, unit_fact b', sourceSilos: [] } }];
  assert.equal((await post(verify, { evidence: heavy, scenario: 'reference' })).status, 404);
});

test('POST bodies over the cap get 413, with or without a content-length', async () => {
  const big = JSON.stringify({ id: run.id, question: 'x'.repeat(100_000) });
  const declared = await ask.POST(new Request('http://t/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big }));
  assert.equal(declared.status, 413);
  const stream = new ReadableStream({
    start(c) {
      for (let k = 0; k < 20; k++) c.enqueue(new TextEncoder().encode('x'.repeat(10_000)));
      c.close();
    },
  });
  const chunked = await ask.POST(new Request('http://t/api/ask', { method: 'POST', body: stream, duplex: 'half' } as RequestInit));
  assert.equal(chunked.status, 413);
  // A normal question still works.
  assert.equal((await post(ask, { id: run.id, question: 'What is the root cause?' })).status, 200);
});

test('the public health check does not disclose the storage path', async () => {
  const text = await (await health.GET()).text();
  assert.ok(!text.includes(storage), 'storage path in /api/health');
  assert.match(text, /"storage":\{"ok":true,"detail":"writable"\}/);
});

test('vision accepts PNG, JPEG and WebP photos only', async () => {
  for (const image of ['data:image/svg+xml;base64,PHN2Zy8+', 'data:image/gif;base64,R0lGODlh', 'https://example.com/a.png']) assert.equal((await post(vision, { image })).status, 400, image);
});

test('Ask the case and the 8D cite the exhibit each verdict quotes', () => {
  const facts = caseFacts(recorded);
  const ruledOut = recorded.hypotheses.filter((x) => x.verdictEvidenceId && x.status !== 'CONFIRMED');
  assert.ok(ruledOut.length >= 4);
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = eightD(recorded);
  for (const h of ruledOut) assert.ok(html.includes(`${esc(h.verdict!)} <span class="cite">[${h.verdictEvidenceId}]</span>`), h.id);
  for (const h of recorded.hypotheses.filter((x) => x.verdictEvidenceId)) {
    const fact = facts.find((f) => f.text.startsWith(`${h.id} "`));
    assert.equal(fact?.cite, h.verdictEvidenceId, h.id);
  }
});
