// NVIDIA NIM client for Nemotron. Uses fetch directly (OpenAI-compatible
// /chat/completions) so the NIM-specific `chat_template_kwargs` field goes in
// the request body as-is. With no NVIDIA_API_KEY, callers get live=false and
// fall back to deterministic templates; the UI labels those outputs.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
export const NEMOTRON_MODEL = process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3.5-super-vl-120b-a12b';
export const NEMOTRON_FAST_MODEL = process.env.NEMOTRON_FAST_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';

export function nemotronLive(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY && !process.env.NVIDIA_API_KEY.startsWith('nvapi-your'));
}

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface NemotronReply {
  live: boolean;
  model: string;
  text: string;
  reasoning: string;
  latencyMs: number;
  cached?: boolean;
  /** Thinking used the whole token budget with no answer, so the call was retried with thinking off. */
  retriedWithoutThinking?: boolean;
  error?: string;
}

// Reply cache: identical requests (same model, messages and settings) return
// the stored reply, so re-running a demo doesn't wait on the model again.
// Disable with NEMOTRON_CACHE=off.
const CACHE_DIR = path.join(process.cwd(), '.nim-cache');
const cacheOn = () => process.env.NEMOTRON_CACHE !== 'off';

function cacheKey(body: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function readCache(key: string): { text: string; reasoning: string; retriedWithoutThinking?: boolean } | null {
  if (!cacheOn()) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, value: { text: string; reasoning: string; retriedWithoutThinking?: boolean }) {
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
  const choice = data.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  let text: string = msg.content ?? '';
  let reasoning: string = msg.reasoning_content ?? msg.reasoning ?? '';
  // Some templates inline the trace as <think>...</think>.
  const think = text.match(/<think>([\s\S]*?)<\/think>/);
  if (think) {
    reasoning = reasoning || think[1].trim();
    text = text.replace(think[0], '').trim();
  }
  return { text: dedupeRepeat(text), reasoning, finishReason: String(choice.finish_reason ?? '') };
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

export async function nemotronChat(opts: {
  system?: string;
  user: Content;
  model?: string;
  thinking?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Race mode: NIM latency for thinking varies 3-5x minute to minute. When set,
   * a no-thinking request runs in parallel; the thinking answer (with its
   * reasoning trace) wins if it arrives within this many ms, otherwise the
   * fast answer is used. Worst case is this deadline, never a hang.
   */
  thinkingDeadlineMs?: number;
}): Promise<NemotronReply> {
  const model = opts.model ?? NEMOTRON_MODEL;
  const start = Date.now();
  if (!nemotronLive()) {
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
    const winner = await Promise.race([slow, new Promise<null>((r) => setTimeout(() => r(null), opts.thinkingDeadlineMs))]);
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
