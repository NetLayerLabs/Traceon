// Meterless Nightshift as the AI provider: the documented protocol (bearer
// token, meterless-app header, meterless/* routes), the route each job uses,
// and the labelled fallback to NVIDIA NIM when Nightshift cannot answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isolatedStorage } from './helpers.mts';

isolatedStorage('nightshift');
process.env.NEMOTRON_CACHE = 'off';

type Seen = { auth?: string; app?: string; scope?: string; model?: string; kwargs?: unknown };
let listed = ['meterless/auto', 'meterless/fast'];
let rejectKwargs = false;
let lastBody: any = null;
const seen: Seen[] = [];
let nightshiftUp = true;
const ok = (res: http.ServerResponse, model: string, content: string) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ model, choices: [{ message: { content }, finish_reason: 'stop' }] }));
};
const nightshift = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  if (req.url === '/v1/models') {
    if (req.headers.authorization !== 'Bearer ns-token') return res.writeHead(401).end();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: listed.map((id) => ({ id })) }));
  }
  if (!nightshiftUp) return res.writeHead(503).end('busy');
  const body = JSON.parse(raw);
  lastBody = body;
  if (rejectKwargs && body.chat_template_kwargs) return res.writeHead(400).end('unknown field chat_template_kwargs');
  seen.push({ kwargs: body.chat_template_kwargs, auth: req.headers.authorization, app: req.headers['meterless-app'] as string, scope: req.headers['meterless-scope'] as string, model: body.model });
  ok(res, body.model, `answer from ${body.model}`);
});
const nim = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  ok(res, JSON.parse(raw).model, 'answer from NIM');
});
await new Promise<void>((r) => nightshift.listen(0, '127.0.0.1', r));
await new Promise<void>((r) => nim.listen(0, '127.0.0.1', r));
process.env.NIGHTSHIFT_URL = `127.0.0.1:${(nightshift.address() as { port: number }).port}/v1/chat/completions`;
process.env.NIGHTSHIFT_TOKEN = 'ns-token';
process.env.NVIDIA_API_KEY = 'nvapi-test';
process.env.NVIDIA_NIM_BASE_URL = `http://127.0.0.1:${(nim.address() as { port: number }).port}/v1`;
const ns = await import('../src/lib/nemotron.ts');

test('pasted URLs normalise to <host>/v1', () => {
  for (const u of ['127.0.0.1:8088', 'http://127.0.0.1:8088/v1', 'http://127.0.0.1:8088/v1/chat/completions', 'http://127.0.0.1:8088/healthz', 'http://127.0.0.1:8088/v1/models'])
    assert.equal(ns.normalizeNightshiftUrl(u), 'http://127.0.0.1:8088/v1');
});

test('each job goes to its Nightshift route with the documented headers', async () => {
  seen.length = 0;
  const fast = await ns.nemotronChat({ model: ns.NEMOTRON_FAST_MODEL, user: 'plan' });
  const deep = await ns.nemotronChat({ user: 'explain' });
  const vision = await ns.nemotronChat({ user: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] });
  assert.deepEqual(seen.map((s) => s.model), ['meterless/fast', 'meterless/deep', 'meterless/vision']);
  assert.ok(seen.every((s) => s.auth === 'Bearer ns-token' && s.app === 'traceon' && s.scope === 'user'));
  assert.equal(fast.provider, 'nightshift');
  assert.equal(deep.via, 'Meterless Nightshift · meterless/deep');
  assert.equal(vision.text, 'answer from meterless/vision');
});

test('when Nightshift cannot answer, NVIDIA NIM does, and the reply says so', async () => {
  nightshiftUp = false;
  const r = await ns.nemotronChat({ user: 'explain', timeoutMs: 2_000 });
  nightshiftUp = true;
  assert.equal(r.provider, 'nim');
  assert.equal(r.text, 'answer from NIM');
  assert.match(r.fallbackFrom ?? '', /^Meterless Nightshift: Nightshift 503/);
  assert.match(r.via ?? '', /^NVIDIA NIM · nemotron/);
});

test('status follows the documented rules; placeholder tokens are refused', async () => {
  assert.equal((await ns.nightshiftStatus()).state, 'online');
  process.env.NIGHTSHIFT_TOKEN = 'wrong';
  assert.equal((await ns.nightshiftStatus()).state, 'unauthorized');
  process.env.NIGHTSHIFT_TOKEN = 'rt-local';
  assert.equal((await ns.nightshiftStatus()).state, 'not configured');
  assert.deepEqual(ns.aiProviders(), ['nim']);
  process.env.NIGHTSHIFT_TOKEN = 'ns-token';
  process.env.AI_PROVIDER = 'nim';
  assert.deepEqual(ns.aiProviders(), ['nim']);
  delete process.env.AI_PROVIDER;
  assert.deepEqual(ns.aiProviders(), ['nightshift', 'nim']);
});

test('with NVIDIA connected to Nightshift, each job uses the matching Nemotron model', async () => {
  listed = ['meterless/auto', 'meterless/fast', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b'];
  ns.resetNightshiftModelCache();
  seen.length = 0;
  const fast = await ns.nemotronChat({ model: ns.NEMOTRON_FAST_MODEL, user: 'plan' });
  await ns.nemotronChat({ user: 'explain' });
  await ns.nemotronChat({ user: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] });
  assert.deepEqual(seen.map((x) => x.model), ['nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3.5-super-vl-120b-a12b']);
  assert.deepEqual(seen[0].kwargs, { enable_thinking: false }, 'the fast jobs never think');
  // Thinking off is also said in Nemotron's own way, and small budgets are raised.
  await ns.nemotronChat({ model: ns.NEMOTRON_FAST_MODEL, system: 'You plan.', user: 'ready?', maxTokens: 20 });
  assert.deepEqual(lastBody.messages.slice(0, 2), [{ role: 'system', content: '/no_think' }, { role: 'system', content: 'You plan.' }]);
  assert.equal(lastBody.max_tokens, 2000);
  assert.equal(fast.via, 'Meterless Nightshift · nvidia/nemotron-3.5-lightning-30b-a3b');
  // Names that differ from NIM's still match by family.
  assert.equal(ns.pickNightshiftModel('fast', ['nim:Nemotron-3.5-Lightning']), 'nim:Nemotron-3.5-Lightning');
  assert.equal(ns.pickNightshiftModel('deep', ['meterless/auto']), 'meterless/deep');
});

test('if Nightshift rejects the thinking switch, the call is repeated without it', async () => {
  rejectKwargs = true;
  seen.length = 0;
  const r = await ns.nemotronChat({ user: 'explain' });
  rejectKwargs = false;
  assert.equal(r.provider, 'nightshift');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kwargs, undefined);
  nightshift.close();
  nim.close();
});

test('damage boxes in any common shape become {x, y, w, h}', async () => {
  const { normalizeBbox } = await import('../src/lib/vision.ts');
  const near = (a: any, b: any) => Object.keys(b).every((k) => Math.abs(a[k] - b[k]) < 1e-9);
  assert.ok(near(normalizeBbox([0.325, 0.26, 0.815, 0.585]), { x: 0.325, y: 0.26, w: 0.49, h: 0.325 }));
  assert.ok(near(normalizeBbox({ x: 0.48, y: 0.36, w: 0.2, h: 0.34 }), { x: 0.48, y: 0.36, w: 0.2, h: 0.34 }));
  assert.ok(near(normalizeBbox({ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 }), { x: 0.1, y: 0.2, w: 0.4, h: 0.4 }));
  assert.ok(near(normalizeBbox([0.1, 0.2, 0.3, 0.3]), { x: 0.1, y: 0.2, w: 0.3, h: 0.3 }));
  assert.equal(normalizeBbox('none'), undefined);
  assert.equal(normalizeBbox([0.5, 0.5, 0, 0]), undefined);
});
