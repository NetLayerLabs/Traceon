import { NextResponse } from 'next/server';
import { verifyLedger } from '@/lib/actions';
import { buildCaseView, loadEvents } from '@/lib/caseView';
import { resolveScenario } from '@/lib/enterpriseData';
import type { EvidenceItem } from '@/lib/investigation';

export const runtime = 'nodejs';

// POST {id}: replay the evidence the server recorded for a run or shared case,
// and compare the rebuilt chain with the root it published.
// POST {evidence, scenario}: replay an exported proof bundle. Its queries are
// re-run read-only (non-SELECT SQL is refused), and the result says whether
// the rebuilt root matches the bundle's own chain.
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { id?: string; evidence?: EvidenceItem[]; scenario?: string };
  try {
    if (body.id) {
      const events = loadEvents(String(body.id));
      if (!events) return NextResponse.json({ error: 'Unknown investigation' }, { status: 404 });
      const view = buildCaseView(events);
      if (!view.done || !view.ledger || !view.scenario) return NextResponse.json({ error: 'The investigation has not finished' }, { status: 409 });
      const v = await verifyLedger(view.evidence, view.scenario.id);
      const rootMatches = v.root === view.ledger.root;
      return NextResponse.json({ ...v, publishedRoot: view.ledger.root, rootMatches, ok: v.ok && rootMatches });
    }
    if (!Array.isArray(body.evidence)) return NextResponse.json({ error: 'id, or an evidence array, is required' }, { status: 400 });
    return NextResponse.json(await verifyLedger(body.evidence, resolveScenario(body.scenario).id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
