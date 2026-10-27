import { NextResponse } from 'next/server';
import { caseForRun, saveCase } from '@/lib/cases';
import { getRun } from '@/lib/runRegistry';

export const runtime = 'nodejs';

// POST {runId}: freeze a finished run as a read-only case for reviewers.
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { runId?: string };
  const runId = typeof body.runId === 'string' ? body.runId : '';
  const run = runId ? getRun(runId) : undefined;
  if (!run) {
    // A run already shared keeps its link after it leaves memory.
    const shared = runId ? caseForRun(runId) : null;
    if (shared) return NextResponse.json({ id: shared.id, url: `/case/${shared.id}` });
    return NextResponse.json({ error: 'Unknown run; it may have expired. Run the investigation again.' }, { status: 404 });
  }
  try {
    const c = saveCase(run.events, run.id);
    return NextResponse.json({ id: c.id, url: `/case/${c.id}` });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
