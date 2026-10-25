import { NextResponse } from 'next/server';
import { saveCase } from '@/lib/cases';
import { getRun } from '@/lib/runRegistry';

export const runtime = 'nodejs';

// POST {runId}: freeze a finished run as a read-only case for reviewers.
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { runId?: string };
  const run = body.runId ? getRun(body.runId) : undefined;
  if (!run) return NextResponse.json({ error: 'Unknown run; it may have expired. Run the investigation again.' }, { status: 404 });
  try {
    const c = saveCase(run.events);
    return NextResponse.json({ id: c.id, url: `/case/${c.id}` });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
