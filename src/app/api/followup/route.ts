import { NextResponse } from 'next/server';
import { buildCaseView, loadEvents } from '@/lib/caseView';
import { simulateFollowUp } from '@/lib/followup';

export const runtime = 'nodejs';

// POST {id, mode}: simulate the 30 days after the planned fix, or after acting
// on the leading confounder instead ("wrong-fix").
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; mode?: string };
  const events = body.id ? loadEvents(body.id) : null;
  if (!events) return NextResponse.json({ error: 'Unknown investigation' }, { status: 404 });
  const view = buildCaseView(events);
  if (!view.gate?.pass) return NextResponse.json({ error: 'The evidence gate did not pass; there is no fix to verify' }, { status: 403 });
  try {
    return NextResponse.json(simulateFollowUp(view, body.mode === 'wrong-fix' ? 'wrong-fix' : 'planned'));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
