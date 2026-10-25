import { NextResponse } from 'next/server';
import { resolveScenario } from '@/lib/enterpriseData';
import type { InvestigationEvent, VisionFinding } from '@/lib/investigation';
import { activeRun, BusyError, getRun, startRun } from '@/lib/runRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST starts an investigation and streams its events as NDJSON. The run itself
// lives in the run registry, so a dropped stream never loses the result.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { vision?: VisionFinding | null; scenario?: string };
  let scenarioId: string;
  try {
    scenarioId = resolveScenario(body.scenario).id;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  let run;
  try {
    run = startRun(scenarioId, body.vision ?? null);
  } catch (err) {
    if (err instanceof BusyError) {
      return NextResponse.json({ error: err.message, runId: err.run.id, scenarioId: err.run.scenarioId }, { status: 409 });
    }
    throw err;
  }
  const encoder = new TextEncoder();
  let listener: ((e: InvestigationEvent) => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: InvestigationEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
        if (e.type === 'done') {
          run.listeners.delete(listener!);
          controller.close();
        }
      };
      for (const e of run.events) send(e);
      listener = send;
      run.listeners.add(listener);
    },
    cancel() {
      // Client went away; the run keeps going and can be polled.
      if (listener) run.listeners.delete(listener);
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Run-Id': run.id },
  });
}

// GET ?run=<id>&from=<n> returns events from index n (stream recovery / attach).
// GET with no params reports the active run, if any.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('run');
  if (!id) {
    const a = activeRun();
    return NextResponse.json({ active: a ? { runId: a.id, scenarioId: a.scenarioId, startedAt: a.startedAt } : null });
  }
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'unknown run' }, { status: 404 });
  const from = Math.max(0, Number(url.searchParams.get('from') ?? 0) || 0);
  return NextResponse.json({ runId: run.id, scenarioId: run.scenarioId, done: run.finishedAt !== null, total: run.events.length, events: run.events.slice(from) });
}
