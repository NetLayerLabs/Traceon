// The agent's AI gateway. Two OpenAI-compatible providers:
//   - Meterless Nightshift (the hackathon's required AI provider): a local
//     runtime on 127.0.0.1:8088 whose model ids are routing modes, e.g.
//     meterless/vision for the photo, meterless/fast for planning and red
//     team, meterless/deep for the explanation.
//   - NVIDIA NIM with Nemotron 3.5, called directly with the NIM-specific
//     `chat_template_kwargs` (thinking on or off).
// AI_PROVIDER=auto (the default) uses Nightshift when it is configured and
// falls back to NIM, labelled, if Nightshift cannot answer; AI_PROVIDER=
// nightshift or nim uses that provider alone. With neither, callers get
// live=false and fall back to deterministic templates; the UI labels those
// outputs.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
export const NEMOTRON_MODEL = process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3.5-super-vl-120b-a12b';
export const NEMOTRON_FAST_MODEL = process.env.NEMOTRON_FAST_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

function nimConfigured(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY && !process.env.NVIDIA_API_KEY.startsWith('nvapi-your'));
}

// ---------- Meterless Nightshift ----------
export type AiProvider = 'nightshift' | 'nim';
export const NO_PROVIDER = 'No AI provider configured';

/** Any pasted form (host, /v1, /v1/chat/completions, /healthz) becomes <host>/v1. */
export function normalizeNightshiftUrl(u: string) {
  let url = u.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  url = url.replace(/\/(v1\/chat\/completions|v1\/models|healthz|v1)$/, '');
  return `${url}/v1`;
}
export const NIGHTSHIFT_URL = normalizeNightshiftUrl(process.env.NIGHTSHIFT_URL || 'http://127.0.0.1:8088/v1');
export const NIGHTSHIFT_ROUTES = {
  vision: process.env.NIGHTSHIFT_VISION_MODEL || 'meterless/vision',
  fast: process.env.NIGHTSHIFT_FAST_MODEL || 'meterless/fast',
  deep: process.env.NIGHTSHIFT_DEEP_MODEL || 'meterless/deep',
};
type Job = keyof typeof NIGHTSHIFT_ROUTES;
const JOB_OVERRIDE: Record<Job, string | undefined> = {
  vision: process.env.NIGHTSHIFT_VISION_MODEL,
  fast: process.env.NIGHTSHIFT_FAST_MODEL,
  deep: process.env.NIGHTSHIFT_DEEP_MODEL,
};
const NIGHTSHIFT_APP = process.env.NIGHTSHIFT_APP || 'traceon';

/**
 * The runtime's bearer token: NIGHTSHIFT_TOKEN, or the file NIGHTSHIFT_TOKEN_FILE
 * names (runtime-token in the Mac app's state folder, proxy-token for the Linux daemon).
 */
function nightshiftToken(): string | null {
  const direct = process.env.NIGHTSHIFT_TOKEN?.trim();
  if (direct && direct !== 'rt-local') return direct;
  const file = process.env.NIGHTSHIFT_TOKEN_FILE;
  if (file) {
    try {
      const t = fs.readFileSync(file, 'utf-8').trim();
      if (t && t !== 'rt-local') return t;
    } catch {}
  }
  return null;
}

/** Providers to try, in order. */
export function aiProviders(): AiProvider[] {
  const mode = (process.env.AI_PROVIDER || 'auto').toLowerCase();
  const ns = nightshiftToken() ? (['nightshift'] as const) : [];
  const nim = nimConfigured() ? (['nim'] as const) : [];
  if (mode === 'nim') return [...nim];
  // Nightshift alone: no NIM fallback, so the photo (no vision lane there) gets the labelled reference analysis.
  if (mode === 'nightshift') return [...ns];
  return [...ns, ...nim];
}

export function aiLive(): boolean {
  return aiProviders().length > 0;
}
/** Kept for existing callers: true when any AI provider is configured. */
export const nemotronLive = aiLive;

export function nightshiftHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'meterless-app': NIGHTSHIFT_APP, 'meterless-scope': 'user' };
}

/** Online, unauthorized (wrong token) or offline, from GET /v1/models as Meterless documents. */
export async function nightshiftStatus(): Promise<{ configured: boolean; state: 'online' | 'unauthorized' | 'offline' | 'not configured'; url: string; routes: string[]; standIn?: boolean }> {
  const token = nightshiftToken();
  if (!token) return { configured: false, state: 'not configured', url: NIGHTSHIFT_URL, routes: [] };
  try {
    const r = await fetch(`${NIGHTSHIFT_URL}/models`, { headers: nightshiftHeaders(token), signal: AbortSignal.timeout(3_000) });
    if (r.status === 401 || r.status === 403) return { configured: true, state: 'unauthorized', url: NIGHTSHIFT_URL, routes: [] };
    if (!r.ok) return { configured: true, state: 'offline', url: NIGHTSHIFT_URL, routes: [] };
    const list = (await r.json()) as { data?: { id: string }[]; standIn?: boolean };
    const ids = (list.data ?? []).map((m) => m.id);
    return { configured: true, state: ids.some((i) => i.startsWith('meterless/')) ? 'online' : 'offline', url: NIGHTSHIFT_URL, routes: ids, ...(list.standIn ? { standIn: true } : {}) };
  } catch {
    return { configured: true, state: 'offline', url: NIGHTSHIFT_URL, routes: [] };
  }
}

/** Short name for the agent trace: "Nightshift" or "Nemotron". */
export function aiName(r?: { provider?: AiProvider; model?: string } | null) {
  if (r?.provider === 'nightshift') return /nemotron/i.test(r.model ?? '') ? 'Nemotron via Nightshift' : 'Nightshift';
  return r?.provider === 'nim' ? 'Nemotron' : 'The model';
}
/** The provider that will be tried first, for phase labels written before a call. */
export function aiPrimaryName() {
  return aiName({ provider: aiProviders()[0] });
}

/** Short label for the UI: which provider and route answered. */
export function aiVia(r: { provider?: AiProvider; model: string; standIn?: boolean }) {
  if (r.provider === 'nightshift') return `${r.standIn ? 'Nightshift stand-in' : 'Meterless Nightshift'} · ${r.model}`;
  return `NVIDIA NIM · ${r.model.replace(/^nvidia\//, '')}`;
}

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface NemotronReply {
  live: boolean;
  /** Who answered; absent when no provider answered. */
  provider?: AiProvider;
  /** "Meterless Nightshift · meterless/deep" or "NVIDIA NIM · nemotron-…". */
  via?: string;
  /** Set when Nightshift could not answer and NIM did instead. */
  fallbackFrom?: string;
  /** Answered by the development stand-in (scripts/mock-nightshift.mts), not the real runtime. */
  standIn?: boolean;
  model: string;
  text: string;
  reasoning: string;
  latencyMs: number;
  cached?: boolean;
  /** Thinking used the whole token budget with no answer, so the call was retried with thinking off. */
  retriedWithoutThinking?: boolean;
  error?: string;
}

// Reply cache: identical requests (same provider, model, messages and
// settings) return the stored reply, marked cached, so re-running a demo
// doesn't wait on the model again. A Nightshift entry also records the model
// that answered, since a meterless/* route picks its own model.
// Disable with NEMOTRON_CACHE=off.
const CACHE_DIR = path.join(process.cwd(), '.nim-cache');
const cacheOn = () => process.env.NEMOTRON_CACHE !== 'off';

function cacheKey(body: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

type CachedReply = { text: string; reasoning: string; model?: string; retriedWithoutThinking?: boolean };

function readCache(key: string): CachedReply | null {
  if (!cacheOn()) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, value: CachedReply) {
  if (!cacheOn()) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
  } catch {
    // A read-only filesystem just means no cache.
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function request(body: Record<string, unknown>, timeoutMs: number, abort?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  let res: Response | null = null;
  // NIM returns transient 5xx/429 under load: retry twice with backoff, inside the same deadline.
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
      body: JSON.stringify(body),
      signal: abort ? AbortSignal.any([AbortSignal.timeout(left), abort]) : AbortSignal.timeout(left),
    });
    const backoff = [600, 1500][attempt];
    if (res.ok || !RETRYABLE.has(res.status) || backoff === undefined || deadline - Date.now() < backoff + 2_000) break;
    await new Promise((r) => setTimeout(r, backoff));
  }
  if (!res.ok) throw new Error(`NIM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return readChoice(data.choices?.[0], (body.chat_template_kwargs as { enable_thinking?: boolean } | undefined)?.enable_thinking === true);
}
/**
 * Some templates inline the trace as <think>...</think>; Nemotron Ultra via
 * Nightshift sends only the closing tag. Either way the trace is split off.
 */
function splitThink(text: string, reasoning: string): { text: string; reasoning: string } {
  const end = text.indexOf('</think>');
  if (end < 0) return { text, reasoning };
  const trace = text.slice(0, end).replace('<think>', '').trim();
  return { text: text.slice(end + '</think>'.length).trim(), reasoning: reasoning || trace };
}

type Choice = { message?: { content?: unknown; reasoning_content?: string; reasoning?: string }; finish_reason?: string };

/**
 * The answer and the reasoning in one reply. A thinking reply that ran out of
 * tokens before its closing </think>, with no separate reasoning field, is all
 * reasoning: it is never returned as the answer.
 */
function readChoice(choice: Choice | undefined, thinking: boolean) {
  const msg = choice?.message ?? {};
  const content = typeof msg.content === 'string' ? msg.content : '';
  const field = msg.reasoning_content ?? msg.reasoning ?? '';
  const finishReason = String(choice?.finish_reason ?? '');
  if (thinking && finishReason === 'length' && !field && !content.includes('</think>')) return { text: '', reasoning: content.replace('<think>', '').trim(), finishReason };
  const { text, reasoning } = splitThink(content, field);
  return { text: dedupeRepeat(text), reasoning, finishReason };
}

/** Models occasionally emit their whole answer twice; keep one copy. */
export function dedupeRepeat(text: string): string {
  const t = text.trim();
  const paras = t.split(/\n\s*\n/);
  for (let period = 1; period <= paras.length / 2; period++) {
    if (paras.length % period) continue;
    const first = paras.slice(0, period).join('\n\n');
    if (paras.every((p, i) => p.trim() === paras[i % period].trim())) return first;
  }
  // A second, slightly reworded copy: the answer restarts with its own opening words.
  const opening = t.slice(0, 48);
  const again = opening.length >= 48 ? t.indexOf(opening, 120) : -1;
  if (again > 0) return t.slice(0, again).trim();
  return t;
}

type ChatOpts = {
  system?: string;
  user: Content;
  model?: string;
  thinking?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  thinkingDeadlineMs?: number;
};

/**
 * One model call through the configured providers: Nightshift first (when
 * configured), then NVIDIA NIM. Each reply says which one answered.
 */
export async function nemotronChat(opts: ChatOpts): Promise<NemotronReply> {
  const providers = aiProviders();
  if (!providers.length) return { live: false, model: opts.model ?? NEMOTRON_MODEL, text: '', reasoning: '', latencyMs: 0, error: NO_PROVIDER };
  let last: NemotronReply | null = null;
  for (const p of providers) {
    const r = p === 'nightshift' ? await nightshiftChat(opts, providers.includes('nim')) : await nimChat(opts);
    const out = { ...r, provider: p, via: aiVia({ provider: p, model: r.model, standIn: r.standIn }) };
    if (out.live && out.text.trim()) return last ? { ...out, fallbackFrom: `Meterless Nightshift: ${last.error ?? 'empty reply'}` } : out;
    last = out;
  }
  return last!;
}

/** The route for a call: the photo goes to meterless/vision, the fast model's jobs to meterless/fast, the rest to meterless/deep. */
export function nightshiftJob(opts: Pick<ChatOpts, 'user' | 'model'>): Job {
  const hasImage = Array.isArray(opts.user) && opts.user.some((c) => c.type === 'image_url');
  if (hasImage) return 'vision';
  return opts.model === NEMOTRON_FAST_MODEL ? 'fast' : 'deep';
}

/**
 * The model id to ask Nightshift for. An explicit NIGHTSHIFT_*_MODEL wins.
 * Otherwise, when NVIDIA Nemotron is connected to Nightshift and appears in
 * its model list, each job uses the matching Nemotron model (Super VL for the
 * photo and the explanation, Lightning for the fast jobs). Nightshift holds
 * Super VL back while NVIDIA serves it unreliably; the explanation then uses
 * Nemotron Ultra. Failing that, the job's meterless/* route.
 * NIGHTSHIFT_USE_NEMOTRON=off disables the lookup.
 */
export function pickNightshiftModel(job: Job, listed: string[]): string {
  if (JOB_OVERRIDE[job]) return JOB_OVERRIDE[job]!;
  if (process.env.NIGHTSHIFT_USE_NEMOTRON !== 'off') {
    const want = job === 'fast' ? NEMOTRON_FAST_MODEL : NEMOTRON_MODEL;
    const short = want.split('/').pop()!.toLowerCase();
    const family = job === 'fast' ? /nemotron.*lightning/i : /nemotron.*super/i;
    const hit =
      listed.find((id) => id === want) ??
      listed.find((id) => id.toLowerCase().endsWith(short)) ??
      listed.find((id) => family.test(id)) ??
      (job === 'deep' ? listed.find((id) => /nemotron.*ultra/i.test(id)) : undefined);
    if (hit) return hit;
  }
  return NIGHTSHIFT_ROUTES[job];
}

// Nightshift's model list, refreshed at most once a minute. A failed lookup
// keeps the last good list, so one slow answer cannot move every job off
// Nemotron, and is tried again after 5 s.
const modelList = { at: 0, ids: [] as string[], failure: '' };
async function nightshiftModelIds(token: string): Promise<{ ids: string[]; ok: boolean; failure: string }> {
  if (Date.now() - modelList.at >= (modelList.failure ? 5_000 : 60_000)) {
    try {
      const r = await fetch(`${NIGHTSHIFT_URL}/models`, { headers: nightshiftHeaders(token), signal: AbortSignal.timeout(3_000) });
      const ids = r.ok ? (((await r.json()) as { data?: { id: string }[] }).data ?? []).map((m) => m.id) : [];
      if (ids.length) modelList.ids = ids;
      modelList.failure = r.status === 401 || r.status === 403 ? 'unauthorized' : !r.ok ? `HTTP ${r.status}` : ids.length ? '' : 'no models listed';
    } catch (err) {
      modelList.failure = (err as Error).message;
    }
    modelList.at = Date.now();
  }
  return { ids: modelList.ids, ok: !modelList.failure, failure: modelList.failure };
}
/** For tests: forget the cached model list. */
export function resetNightshiftModelCache() {
  Object.assign(modelList, { at: 0, ids: [], failure: '' });
}

/** The default route for a call, before any model list is known. */
export function nightshiftRoute(opts: Pick<ChatOpts, 'user' | 'model'>) {
  return NIGHTSHIFT_ROUTES[nightshiftJob(opts)];
}

/** One call to Nightshift. `nimNext`: NIM is tried after it if this call fails. */
async function nightshiftChat(opts: ChatOpts, nimNext: boolean): Promise<NemotronReply> {
  const token = nightshiftToken()!;
  const job = nightshiftJob(opts);
  const list = await nightshiftModelIds(token);
  const model = pickNightshiftModel(job, list.ids);
  const start = Date.now();
  // No model list: Nightshift is offline, hung or refusing the token. With NIM
  // next, go straight to it instead of spending this call's budget here.
  if (!list.ok && nimNext) return { live: false, model, text: '', reasoning: '', latencyMs: 0, error: `model list unavailable (${list.failure})` };
  // Nemotron through Nightshift: thinking is off for the fast jobs (it can use
  // the whole budget and return nothing), and off for the others too unless
  // NIGHTSHIFT_THINKING=on, because there is no fast-answer race on this path.
  // The switch goes two ways, since Nightshift may not pass chat_template_kwargs
  // through: the kwarg, and Nemotron's own "/no_think" system message. Other
  // teams found small budgets came back empty this way, so Nemotron gets at
  // least 2,000 tokens.
  const nemotron = /nemotron/i.test(model);
  const thinking = job !== 'fast' && process.env.NIGHTSHIFT_THINKING === 'on' && (opts.thinking ?? true);
  const messages = [
    ...(nemotron && !thinking ? [{ role: 'system', content: '/no_think' }] : []),
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: opts.user },
  ];
  const maxTokens = nemotron ? Math.max(2_000, opts.maxTokens ?? 2_048) : (opts.maxTokens ?? 2_048);
  const body: Record<string, unknown> = { model, messages, temperature: 0.2, max_tokens: maxTokens, ...(nemotron ? { chat_template_kwargs: { enable_thinking: thinking } } : {}) };
  const key = cacheKey({ nightshift: NIGHTSHIFT_URL, ...body });
  // A stored reply is used only while Nightshift answers, and only if it
  // records the model that answered, so its label is never a guess.
  const hit = list.ok ? readCache(key) : null;
  if (hit?.model) return { live: true, ...hit, model: hit.model, latencyMs: Date.now() - start, cached: true };
  // Meterless suggests long timeouts because a local model may be loading;
  // the caller's budget still caps it so a run cannot stall. With NIM next,
  // Nightshift gets half of it, so the fallback keeps time to answer.
  const budget = Math.min(opts.timeoutMs ?? 60_000, Number(process.env.NEMOTRON_TIMEOUT_MS) || Infinity);
  const timeoutMs = nimNext ? Math.min(budget, Math.max(5_000, Math.floor(budget / 2))) : budget;
  try {
    const post = (b: Record<string, unknown>) =>
      fetch(`${NIGHTSHIFT_URL}/chat/completions`, {
        method: 'POST',
        headers: { ...nightshiftHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
        signal: AbortSignal.timeout(Math.max(1_000, timeoutMs - (Date.now() - start))),
      });
    let sent = body;
    let res = await post(sent).catch((e: Error) => e);
    // One retry after a short pause for a cold or busy runtime, inside the same budget.
    if ((res instanceof Error && res.name !== 'TimeoutError') || (!(res instanceof Error) && (res.status >= 500 || res.status === 429))) {
      if (timeoutMs - (Date.now() - start) > 4_000) {
        await new Promise((r) => setTimeout(r, 1_500));
        res = await post(sent).catch((e: Error) => e);
      }
    }
    if (res instanceof Error) throw res;
    // If Nightshift will not pass Nemotron's thinking switch through, ask without it.
    if (res.status === 400 && 'chat_template_kwargs' in sent) {
      const { chat_template_kwargs: _drop, ...plain } = sent;
      sent = plain;
      res = await post(sent);
    }
    if (res.status === 401 || res.status === 403) throw new Error('Nightshift rejected the token (unauthorized)');
    if (!res.ok) throw new Error(`Nightshift ${res.status}: ${(await res.text()).slice(0, 200)}`);
    let data = await res.json();
    const reply = readChoice(data.choices?.[0], thinking);
    const reasoning = reply.reasoning;
    let text = reply.text;
    let retriedWithoutThinking = false;
    // Thinking used the whole token budget before answering: what came back is
    // reasoning. Ask once more with thinking off, inside the same budget.
    const cutOff = thinking && !text.trim() && reply.finishReason === 'length';
    if (cutOff && timeoutMs - (Date.now() - start) > 3_000) {
      const again = await post({ ...sent, messages: [{ role: 'system', content: '/no_think' }, ...messages], ...('chat_template_kwargs' in sent ? { chat_template_kwargs: { enable_thinking: false } } : {}) });
      if (again.ok) {
        data = await again.json();
        text = readChoice(data.choices?.[0], false).text;
        retriedWithoutThinking = true;
      }
    }
    const standIn = data.system_fingerprint === 'nightshift-standin';
    const answered = String(data.model ?? model);
    if (text.trim() && !standIn) writeCache(key, { text, reasoning, model: answered, ...(retriedWithoutThinking ? { retriedWithoutThinking } : {}) });
    return {
      live: true,
      model: answered,
      text,
      reasoning,
      latencyMs: Date.now() - start,
      ...(standIn ? { standIn } : {}),
      ...(retriedWithoutThinking ? { retriedWithoutThinking } : {}),
      ...(cutOff && !text.trim() ? { error: 'thinking used the whole token budget' } : {}),
    };
  } catch (err) {
    return { live: false, model, text: '', reasoning: '', latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

async function nimChat(opts: {
  system?: string;
  user: Content;
  model?: string;
  thinking?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Race mode: NIM latency for thinking varies 3-5x minute to minute. When set,
   * a no-thinking request runs in parallel; the thinking answer (with its
   * reasoning trace) wins if it arrives within this many ms and no later than
   * NEMOTRON_THINKING_GRACE_MS (default 4,000) after the fast answer,
   * otherwise the fast answer is used. Worst case is this deadline, never a hang.
   */
  thinkingDeadlineMs?: number;
}): Promise<NemotronReply> {
  const model = opts.model ?? NEMOTRON_MODEL;
  const start = Date.now();
  if (!nimConfigured()) {
    return { live: false, model, text: '', reasoning: '', latencyMs: 0, error: 'NVIDIA_API_KEY not set' };
  }
  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: opts.user },
  ];
  const thinking = opts.thinking ?? true;
  const body = { model, messages, temperature: 0.2, max_tokens: opts.maxTokens ?? 2048, chat_template_kwargs: { enable_thinking: thinking } };
  const key = cacheKey(body);
  const hit = readCache(key);
  if (hit) return { live: true, model, ...hit, latencyMs: Date.now() - start, cached: true };
  // NEMOTRON_TIMEOUT_MS caps every call so a slow model can't stall a demo.
  const timeoutMs = Math.min(opts.timeoutMs ?? 60_000, Number(process.env.NEMOTRON_TIMEOUT_MS) || Infinity);
  if (thinking && opts.thinkingDeadlineMs) {
    const thinkingAbort = new AbortController();
    const fastBody = { ...body, chat_template_kwargs: { enable_thinking: false } };
    const fast = request(fastBody, timeoutMs).catch((err: Error) => err);
    const slow = request(body, timeoutMs, thinkingAbort.signal).catch((err: Error) => err);
    // A ready fast answer does not wait out the whole deadline: thinking gets a short grace period.
    const graceMs = Number(process.env.NEMOTRON_THINKING_GRACE_MS || 4_000);
    const after = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));
    const fastThenGrace = fast.then((f) => (f instanceof Error || !f.text.trim() ? new Promise<null>(() => {}) : after(graceMs)));
    const winner = await Promise.race([slow, fastThenGrace, after(opts.thinkingDeadlineMs)]);
    if (winner && !(winner instanceof Error) && winner.text.trim()) {
      writeCache(key, { text: winner.text, reasoning: winner.reasoning });
      return { live: true, model, text: winner.text, reasoning: winner.reasoning, latencyMs: Date.now() - start };
    }
    thinkingAbort.abort();
    const f = await fast;
    if (f instanceof Error) return { live: false, model, text: '', reasoning: '', latencyMs: Date.now() - start, error: f.message };
    // Cached too, so a demo re-run is instant even when the endpoint is congested.
    if (f.text.trim()) writeCache(key, { text: f.text, reasoning: '', retriedWithoutThinking: true });
    return { live: true, model, text: f.text, reasoning: '', latencyMs: Date.now() - start, retriedWithoutThinking: true };
  }
  try {
    let r = await request(body, timeoutMs);
    let retriedWithoutThinking = false;
    // Thinking can spend the whole budget and return no answer; retry once without it.
    if (thinking && !r.text.trim() && r.finishReason === 'length') {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining > 3_000) {
        const first = r.reasoning;
        r = await request({ ...body, chat_template_kwargs: { enable_thinking: false } }, remaining);
        r.reasoning = r.reasoning || first;
        retriedWithoutThinking = true;
      }
    }
    if (r.text.trim()) writeCache(key, { text: r.text, reasoning: r.reasoning, retriedWithoutThinking });
    return { live: true, model, text: r.text, reasoning: r.reasoning, latencyMs: Date.now() - start, retriedWithoutThinking };
  } catch (err) {
    return { live: false, model, text: '', reasoning: '', latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

/** Pull the first JSON object or array out of a model reply. */
export function extractJson<T>(text: string): T | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? null;
  const body = m ? m[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
