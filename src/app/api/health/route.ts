import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { STORAGE_DIR } from '@/lib/meterless';
import { aiProviders, nemotronLive } from '@/lib/nemotron';
import { activeRun } from '@/lib/runRegistry';
import { fetchCpscEbikeRecalls, fetchNhtsaBatteryFires, fetchOpenFdaBatteryEvents } from '@/lib/signals';
import { runFederatedQuery, zetarisMode } from '@/lib/zetaris';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let feedCache: { at: number; value: Record<string, string> } | null = null;

// 200 when the core works (query engine + durable storage); 503 otherwise.
// External feeds and models only mark the service "degraded": the app is
// designed to keep working without them.
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  const t = performance.now();
  try {
    const r = await runFederatedQuery('SELECT COUNT(*) AS n FROM unit_fact', ['unit_fact']);
    const n = Number(r.rows[0]?.n);
    checks.queryEngine = { ok: n === 180_000, detail: `${r.executedVia}: ${n} units in ${Math.round(performance.now() - t)}ms` };
  } catch {
    checks.queryEngine = { ok: false, detail: 'query failed' };
  }

  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    const probe = path.join(STORAGE_DIR, '.health');
    fs.writeFileSync(probe, String(Date.now()));
    fs.rmSync(probe);
    // The path stays on the server: this endpoint is public.
    checks.storage = { ok: true, detail: 'writable' };
  } catch {
    checks.storage = { ok: false, detail: 'not writable' };
  }

  if (!feedCache || Date.now() - feedCache.at > 300_000) {
    const [a, b, c] = await Promise.all([fetchCpscEbikeRecalls(), fetchOpenFdaBatteryEvents(), fetchNhtsaBatteryFires()]);
    feedCache = { at: Date.now(), value: Object.fromEntries([a, b, c].map((f) => [f.feed, f.status])) };
  }
  const feedsOk = Object.values(feedCache.value).every((s) => s === 'live');
  const run = activeRun();
  const core = checks.queryEngine.ok && checks.storage.ok;
  const body = {
    status: core ? (feedsOk && nemotronLive() ? 'ok' : 'degraded') : 'down',
    checks,
    feeds: feedCache.value,
    nemotron: nemotronLive() ? 'live' : 'offline (templates)',
    aiProviders: aiProviders(),
    zetaris: zetarisMode(),
    activeRun: run ? { runId: run.id, scenarioId: run.scenarioId, runningForMs: Date.now() - run.startedAt } : null,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: core ? 200 : 503 });
}
