// Regressions for the AI provider layer and the app shell (audit of Oct 27):
// a cached reply says so and is never credited to a Nightshift that is down,
// a model-list blip keeps the last good list, thinking cut off mid-trace is
// never the answer, AI_PROVIDER=nightshift uses Nightshift alone, the NIM race
// stops waiting once the fast answer is in, /api/status names the models each
// job really uses, and /app labels nothing before it knows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isolatedStorage } from './helpers.mts';

isolatedStorage('fix-ai');
// The reply cache is written to <cwd>/.nim-cache: keep it out of the repo.
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-fix-ai-cwd-')));
process.env.NEMOTRON_CACHE = 'off';
for (const k of ['AI_PROVIDER', 'NIGHTSHIFT_TOKEN_FILE', 'NIGHTSHIFT_THINKING', 'NIGHTSHIFT_USE_NEMOTRON', 'NIGHTSHIFT_VISION_MODEL', 'NIGHTSHIFT_FAST_MODEL', 'NIGHTSHIFT_DEEP_MODEL', 'NEMOTRON_TIMEOUT_MS', 'NEMOTRON_THINKING_GRACE_MS', 'TRACEON_DISABLE_RESET', 'ZETARIS_API_URL', 'BRIGHTDATA_API_TOKEN'])
  delete process.env[k];

type Reply = { status?: number; hang?: boolean; model?: string; content?: string; reasoning?: string; finish?: string };
const read = async (req: http.IncomingMessage) => {
  let raw = '';
  for await (const c of req) raw += c;
  return raw;
};
const send = (res: http.ServerResponse, model: string, r: Reply) => {
  if (res.socket?.destroyed) return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ model, choices: [{ message: { content: r.content ?? '', reasoning_content: r.reasoning ?? '' }, finish_reason: r.finish ?? 'stop' }] }));
};

// Nightshift stand-in for the tests: its model list and chat replies are set per test.
const ns = {
  listed: ['meterless/auto', 'meterless/fast'],
  models: 'ok' as 'ok' | 'fail' | 'hang',
  chat: (b: any): Reply => ({ content: `answer from ${b.model}` }),
  seen: [] as any[],
  modelCalls: 0,
};
const nightshift = http.createServer(async (req, res) => {
  const raw = await read(req);
  if (req.url === '/v1/models') {
    ns.modelCalls++;
    if (ns.models === 'hang') return;
    if (ns.models === 'fail') return res.writeHead(500).end('down');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: ns.listed.map((id) => ({ id })) }));
  }
  const body = JSON.parse(raw);
  ns.seen.push(body);
  const r = ns.chat(body);
  if (r.hang) return;
  if (r.status) return res.writeHead(r.status).end('error');
  send(res, r.model ?? body.model, r);
});

// NVIDIA NIM stand-in: thinking requests can be slowed down.
const thinkingOn = (b: any) => b.chat_template_kwargs?.enable_thinking === true;
const defaultNim = (b: any): Reply => (thinkingOn(b) ? { content: 'thought-through answer', reasoning: 'trace' } : { content: 'answer from NIM' });
const nim = { reply: defaultNim, thinkingDelayMs: 0, calls: 0 };
const nimServer = http.createServer(async (req, res) => {
  const body = JSON.parse(await read(req));
  nim.calls++;
  const r = nim.reply(body);
  const delay = thinkingOn(body) ? nim.thinkingDelayMs : 0;
  if (delay) setTimeout(() => send(res, body.model, r), delay);
  else send(res, body.model, r);
});

await new Promise<void>((r) => nightshift.listen(0, '127.0.0.1', r));
await new Promise<void>((r) => nimServer.listen(0, '127.0.0.1', r));
const port = (s: http.Server) => (s.address() as { port: number }).port;
process.env.NIGHTSHIFT_URL = `http://127.0.0.1:${port(nightshift)}/v1`;
process.env.NIGHTSHIFT_TOKEN = 'ns-token';
process.env.NVIDIA_API_KEY = 'nvapi-test';
process.env.NVIDIA_NIM_BASE_URL = `http://127.0.0.1:${port(nimServer)}/v1`;
const m = await import('../src/lib/nemotron.ts');

test.after(() => {
  for (const s of [nightshift, nimServer]) {
    s.closeAllConnections();
    s.close();
  }
});

const fresh = () => {
  m.resetNightshiftModelCache();
  ns.seen.length = 0;
  ns.modelCalls = 0;
  ns.models = 'ok';
};

test('a cached reply says so, names the model that answered, and is not used while Nightshift is down', async () => {
  process.env.NEMOTRON_CACHE = 'on';
  try {
    fresh();
    ns.listed = ['meterless/auto', 'meterless/fast'];
    ns.chat = () => ({ model: 'webllm/Llama-3.2-1B', content: 'from the small model' });
    const ask = { model: m.NEMOTRON_FAST_MODEL, user: 'Rank these hypotheses', timeoutMs: 3_000 };
    const first = await m.nemotronChat(ask);
    assert.equal(first.via, 'Meterless Nightshift · webllm/Llama-3.2-1B');
    assert.equal(first.cached, undefined);
    const again = await m.nemotronChat(ask);
    assert.equal(again.cached, true);
    assert.equal(again.via, 'Meterless Nightshift · webllm/Llama-3.2-1B', 'the model that answered, not the route asked for');
    assert.equal(ns.seen.length, 1, 'the second reply came from the cache');

    // An entry that does not record which model answered is not trusted.
    const dir = path.join(process.cwd(), '.nim-cache');
    for (const f of fs.readdirSync(dir)) {
      const { model: _model, ...entry } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      fs.writeFileSync(path.join(dir, f), JSON.stringify(entry));
    }
    assert.equal((await m.nemotronChat(ask)).cached, undefined);
    assert.equal(ns.seen.length, 2);

    // Nightshift stops answering: NIM answers, labelled, and nothing is sent to Nightshift.
    ns.models = 'fail';
    ns.chat = () => ({ status: 503 });
    m.resetNightshiftModelCache();
    const down = await m.nemotronChat(ask);
    assert.equal(down.provider, 'nim');
    assert.equal(down.cached, undefined);
    assert.equal(down.fallbackFrom, 'Meterless Nightshift: model list unavailable (HTTP 500)');
    assert.equal(ns.seen.length, 2);

    // Nightshift alone and down: the stored reply is still not passed off as an answer.
    delete process.env.NVIDIA_API_KEY;
    m.resetNightshiftModelCache();
    const alone = await m.nemotronChat(ask);
    assert.equal(alone.live, false);
    assert.equal(alone.cached, undefined);
  } finally {
    process.env.NEMOTRON_CACHE = 'off';
    process.env.NVIDIA_API_KEY = 'nvapi-test';
  }
});

test('a failed model-list lookup keeps the last good list and is tried again after 5 s', async (t) => {
  fresh();
  delete process.env.NVIDIA_API_KEY; // Nightshift alone, so it is asked even without a fresh list
  ns.listed = ['meterless/fast', 'nvidia/nemotron-3.5-lightning-30b-a3b'];
  ns.chat = (b) => ({ content: `answer from ${b.model}` });
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  t.after(() => {
    Date.now = realNow;
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    ns.models = 'ok';
  });
  const plan = { model: m.NEMOTRON_FAST_MODEL, user: 'plan', timeoutMs: 3_000 };
  await m.nemotronChat(plan);
  ns.models = 'fail';
  shift = 61_000; // the list is due for its refresh, and the refresh fails
  await m.nemotronChat(plan);
  await m.nemotronChat(plan); // within 5 s of the failure: not looked up again
  assert.equal(ns.modelCalls, 2);
  ns.models = 'ok';
  shift += 6_000;
  await m.nemotronChat(plan);
  assert.equal(ns.modelCalls, 3, 'the failed lookup was retried');
  assert.deepEqual(
    ns.seen.map((b) => b.model),
    Array(4).fill('nvidia/nemotron-3.5-lightning-30b-a3b'),
    'no job moved to meterless/fast'
  );
});

test('a hung Nightshift costs its 3 s model-list timeout, not the call budget, when NIM is next', async () => {
  fresh();
  ns.models = 'hang';
  ns.chat = () => ({ hang: true });
  const t0 = Date.now();
  const r = await m.nemotronChat({ model: m.NEMOTRON_FAST_MODEL, user: 'plan', timeoutMs: 20_000 });
  const ms = Date.now() - t0;
  ns.models = 'ok';
  assert.equal(r.provider, 'nim');
  assert.match(r.fallbackFrom ?? '', /^Meterless Nightshift: model list unavailable/);
  assert.equal(ns.seen.length, 0);
  assert.ok(ms < 6_000, `took ${ms} ms`);
});

test('with NIM next, Nightshift gets half of the call budget', async () => {
  fresh();
  ns.chat = () => ({ hang: true });
  const t0 = Date.now();
  const r = await m.nemotronChat({ model: m.NEMOTRON_FAST_MODEL, user: 'plan', timeoutMs: 10_000 });
  const ms = Date.now() - t0;
  assert.equal(r.provider, 'nim');
  assert.match(r.fallbackFrom ?? '', /timeout|aborted/i);
  assert.ok(ms >= 4_500 && ms < 8_000, `took ${ms} ms`);
});

test('AI_PROVIDER=nightshift uses Nightshift alone', async () => {
  fresh();
  process.env.AI_PROVIDER = 'nightshift';
  try {
    assert.deepEqual(m.aiProviders(), ['nightshift']);
    ns.chat = () => ({ status: 503 });
    const before = nim.calls;
    const r = await m.nemotronChat({ user: 'explain', timeoutMs: 2_000 });
    assert.equal(r.live, false);
    assert.equal(r.provider, 'nightshift');
    assert.equal(nim.calls, before, 'NIM was not asked');
    process.env.AI_PROVIDER = 'nim';
    assert.deepEqual(m.aiProviders(), ['nim']);
  } finally {
    delete process.env.AI_PROVIDER;
  }
  assert.deepEqual(m.aiProviders(), ['nightshift', 'nim']);
});

test('NIGHTSHIFT_THINKING=on: a reply cut off mid-thinking is never returned as the answer', async () => {
  fresh();
  process.env.NIGHTSHIFT_THINKING = 'on';
  delete process.env.NVIDIA_API_KEY;
  ns.listed = ['meterless/deep', 'nvidia/nemotron-3-ultra-550b-a55b'];
  const trace = 'We need to explain the finding to a VP. The user asks: write 3-4 paragraphs. Let me check the facts';
  let retryAnswers = true;
  ns.chat = (b) => (thinkingOn(b) ? { content: trace, finish: 'length' } : retryAnswers ? { content: 'The cell batch is the cause.' } : { status: 500 });
  try {
    const r = await m.nemotronChat({ user: 'explain', thinking: true, maxTokens: 2_000, timeoutMs: 10_000 });
    assert.equal(r.text, 'The cell batch is the cause.');
    assert.equal(r.reasoning, trace);
    assert.equal(r.retriedWithoutThinking, true);
    assert.equal(r.via, 'Meterless Nightshift · nvidia/nemotron-3-ultra-550b-a55b');
    assert.equal(ns.seen.length, 2);
    assert.deepEqual(ns.seen[1].chat_template_kwargs, { enable_thinking: false });
    assert.equal(ns.seen[1].messages[0].content, '/no_think');
    // The retry fails too: the reply is empty, never the trace.
    retryAnswers = false;
    const empty = await m.nemotronChat({ user: 'explain again', thinking: true, maxTokens: 2_000, timeoutMs: 10_000 });
    assert.equal(empty.text, '');
    assert.equal(empty.reasoning, trace);
    assert.match(empty.error ?? '', /whole token budget/);
  } finally {
    delete process.env.NIGHTSHIFT_THINKING;
    process.env.NVIDIA_API_KEY = 'nvapi-test';
  }
});

test('NIM: thinking cut off before </think> is retried with thinking off, not returned', async () => {
  process.env.AI_PROVIDER = 'nim';
  nim.reply = (b) => (thinkingOn(b) ? { content: 'Let me think about the batch first', finish: 'length' } : { content: 'answer from NIM' });
  try {
    const r = await m.nemotronChat({ user: 'explain', thinking: true, timeoutMs: 10_000 });
    assert.equal(r.text, 'answer from NIM');
    assert.equal(r.reasoning, 'Let me think about the batch first');
    assert.equal(r.retriedWithoutThinking, true);
  } finally {
    delete process.env.AI_PROVIDER;
    nim.reply = defaultNim;
  }
});

test('NIM race: a ready fast answer waits only the grace period, and thinking still wins inside it', async () => {
  process.env.AI_PROVIDER = 'nim';
  try {
    process.env.NEMOTRON_THINKING_GRACE_MS = '300';
    nim.thinkingDelayMs = 2_500;
    const t0 = Date.now();
    const fast = await m.nemotronChat({ user: 'explain, slow thinking', thinkingDeadlineMs: 4_000, timeoutMs: 20_000 });
    const ms = Date.now() - t0;
    assert.ok(ms < 1_500, `took ${ms} ms`);
    assert.equal(fast.text, 'answer from NIM');
    assert.equal(fast.retriedWithoutThinking, true);

    process.env.NEMOTRON_THINKING_GRACE_MS = '2000';
    nim.thinkingDelayMs = 50;
    const thought = await m.nemotronChat({ user: 'explain, quick thinking', thinkingDeadlineMs: 4_000, timeoutMs: 20_000 });
    assert.equal(thought.text, 'thought-through answer');
    assert.equal(thought.reasoning, 'trace');
  } finally {
    delete process.env.AI_PROVIDER;
    delete process.env.NEMOTRON_THINKING_GRACE_MS;
    nim.thinkingDelayMs = 0;
  }
});

test('the case file keeps the cached flag of the plan, red team and explanation', async () => {
  const { foldEvents } = await import('../src/components/state.ts');
  const s = foldEvents([
    { type: 'plan', source: 'nemotron', via: 'v', by: 'Nemotron', reasoning: 'r', untestable: [], hypotheses: [], cached: true },
    { type: 'redteam', source: 'nemotron', via: 'v', objections: [], reasoning: '', cached: true },
    { type: 'narrative', source: 'nemotron', via: 'v', text: 't', reasoning: '', cached: true, guard: { checked: 0, verified: 0, unverified: [] } },
  ] as never);
  assert.equal(s.narrative?.cached, true);
  assert.equal((s.plan as { cached?: boolean } | null)?.cached, true);
  assert.equal((s.redteam as { cached?: boolean } | null)?.cached, true);
  assert.deepEqual(s.hypotheses, []);
  assert.equal('type' in s.narrative!, false);
});

test('/api/status names the model each job asks Nightshift for, and counts Nemotron through Nightshift as live', async () => {
  fresh();
  const { GET } = await import('../src/app/api/status/route.ts');
  const status = async () => (await GET(new Request('http://localhost/api/status?scenario=reference'))).json();
  const lightning = 'nvidia/nemotron-3.5-lightning-30b-a3b';
  const ultra = 'nvidia/nemotron-3-ultra-550b-a55b';
  ns.listed = ['meterless/auto', 'meterless/fast', 'meterless/deep', lightning, ultra];
  delete process.env.NVIDIA_API_KEY; // Nightshift is the only provider
  try {
    let s = await status();
    assert.deepEqual(s.ai.nightshift.routes, { vision: 'meterless/vision (not listed)', fast: lightning, deep: ultra });
    assert.deepEqual(s.ai.nightshift.listed, ns.listed);
    assert.equal(s.nemotron.live, true);
    assert.deepEqual(s.nemotron.viaNightshift, [lightning, ultra]);
    assert.equal(s.resetDisabled, false);

    process.env.NVIDIA_API_KEY = 'nvapi-test';
    process.env.TRACEON_DISABLE_RESET = '1';
    s = await status();
    assert.equal(s.ai.nightshift.routes.vision, 'meterless/vision (not listed; NIM answers)');
    assert.equal(s.resetDisabled, true);

    // Neither provider: nothing is live and no route is claimed.
    delete process.env.NVIDIA_API_KEY;
    process.env.NIGHTSHIFT_TOKEN = 'rt-local';
    s = await status();
    assert.equal(s.nemotron.live, false);
    assert.equal(s.ai.nightshift.routes, null);
  } finally {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    process.env.NIGHTSHIFT_TOKEN = 'ns-token';
    delete process.env.TRACEON_DISABLE_RESET;
  }
});

test('/app labels no integration live, offline or simulated before its status arrives', async () => {
  const React = await import('react');
  // tsx compiles the page's JSX to React.createElement (tsconfig leaves JSX to Next), so React must be global.
  Object.assign(globalThis, { React });
  const { renderToString } = await import('react-dom/server');
  const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
  const { default: Home } = await import('../src/app/app/page.tsx');
  const html = renderToString(React.createElement(PathnameContext.Provider, { value: '/app' }, React.createElement(Home)));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Checking integrations…/);
  assert.doesNotMatch(text, /Nemotron offline|Zetaris local mirror|Bright Data simulated|H-MEM 0 memories/);
  assert.doesNotMatch(text, /Reset demo/, 'the button waits for the status, which says whether reset is disabled');
});
