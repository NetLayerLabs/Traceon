import { NextResponse } from 'next/server';
import { analyze, CASES, liveSnapshot, loadSnapshot, recallFollowUp } from '@/lib/realRecall';
import type { Snapshot } from '@/lib/realRecall';

const withFollowUp = (snap: Snapshot) => {
  const bt = analyze(snap);
  return { ...bt, followUp: recallFollowUp(snap, bt) };
};

export const runtime = 'nodejs';
export const maxDuration = 300;

// GET lists the bundled real-recall cases (or one with ?case=); the analysis
// runs on NHTSA snapshots shipped with the app, so it works offline.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('case');
  if (id) {
    const snap = loadSnapshot(id);
    if (!snap) return NextResponse.json({ error: 'unknown case' }, { status: 404 });
    return NextResponse.json(withFollowUp(snap));
  }
  const cases = CASES.map((c) => {
    const snap = loadSnapshot(c.id);
    if (!snap) return null;
    const { series, firesBeforeAlert, ...summary } = analyze(snap);
    return { ...summary, firesBeforeAlertCount: firesBeforeAlert.length, seriesPoints: series.length };
  }).filter(Boolean);
  return NextResponse.json({ cases });
}

// POST {make, model, years} runs the same test live against api.nhtsa.gov.
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { make?: string; model?: string; years?: number[] };
  const make = String(body.make ?? '').trim().toUpperCase();
  const model = String(body.model ?? '').trim().toUpperCase();
  const years = (Array.isArray(body.years) ? body.years : []).map(Number).filter((y) => y >= 1995 && y <= 2030).slice(0, 6);
  if (!/^[A-Z0-9 .-]{2,30}$/.test(make) || !/^[A-Z0-9 .-]{1,40}$/.test(model) || !years.length) {
    return NextResponse.json({ error: 'make, model and one to six model years are required' }, { status: 400 });
  }
  try {
    const snap = await liveSnapshot(make, model, years);
    // No complaints at all is not a result ("signal fired: never"): say what NHTSA has.
    if (!snap.complaints.length)
      return NextResponse.json({ error: `NHTSA has no complaints for ${make} ${model} in ${years.join(', ')}. Check the spelling; NHTSA lists some models under variant names (a cab or seating version).` }, { status: 422 });
    return NextResponse.json(withFollowUp(snap));
  } catch (err) {
    return NextResponse.json({ error: `NHTSA lookup failed: ${(err as Error).message}` }, { status: 502 });
  }
}
