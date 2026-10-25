import { NextResponse } from 'next/server';
import { buildCaseView, loadEvents } from '@/lib/caseView';
import { counterfactualInputs } from '@/lib/counterfactual';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const events = loadEvents(id);
  if (!events) return NextResponse.json({ error: 'Unknown investigation' }, { status: 404 });
  const inputs = counterfactualInputs(buildCaseView(events));
  if (!inputs) return NextResponse.json({ error: 'No confirmed cause to simulate' }, { status: 422 });
  return NextResponse.json(inputs);
}
