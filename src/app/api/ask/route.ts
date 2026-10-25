import { NextResponse } from 'next/server';
import { askCase } from '@/lib/ask';
import { buildCaseView, loadEvents } from '@/lib/caseView';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST {id, question}: id is a run id or a saved case id.
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { id?: string; question?: string };
  const question = String(body.question ?? '').trim().slice(0, 500);
  if (!body.id || !question) return NextResponse.json({ error: 'id and question are required' }, { status: 400 });
  const events = loadEvents(body.id);
  if (!events) return NextResponse.json({ error: 'Unknown investigation; run it again' }, { status: 404 });
  const view = buildCaseView(events);
  if (!view.done) return NextResponse.json({ error: 'The investigation is still running' }, { status: 409 });
  return NextResponse.json(await askCase(view, question));
}
