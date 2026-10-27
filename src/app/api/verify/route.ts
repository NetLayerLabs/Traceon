import { NextResponse } from 'next/server';
import { verifyLedger } from '@/lib/actions';
import { buildCaseView, loadEvents } from '@/lib/caseView';
import { resolveScenario } from '@/lib/enterpriseData';
import type { EvidenceItem } from '@/lib/investigation';
import { readJson } from '@/lib/http';
import { findRecorded } from '@/lib/runRegistry';

export const runtime = 'nodejs';

// A proof bundle carries every exhibit's payload; uploaded datasets make it larger.
const VERIFY_BODY = 10_000_000;

// POST {id}: replay the evidence the server recorded for a run or shared case,
// and compare the rebuilt chain with the root it published.
// POST {evidence, scenario, ledgerRoot?}: replay an exported proof bundle of a
// run or case this server recorded (found by its ledger root, or by the last
// exhibit's chain hash). Only queries the server recorded for that run are
// re-run; any other SQL in the bundle is reported as a mismatch, never executed.
// The result says whether the rebuilt root matches the bundle's own chain.
export async function POST(req: Request) {
  const raw = await readJson<{ id?: string; evidence?: EvidenceItem[]; scenario?: string }>(req, VERIFY_BODY);
  if (raw instanceof Response) return raw;
  const body = (raw ?? {}) as { id?: string; evidence?: EvidenceItem[]; scenario?: string; ledgerRoot?: string };
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
    const exhibit = (it: unknown) => !!it && typeof it === 'object' && ['id', 'label', 'proofHash'].every((k) => typeof (it as Record<string, unknown>)[k] === 'string');
    if (!body.evidence.every(exhibit)) return NextResponse.json({ error: 'Each exhibit needs a string id, label and proofHash' }, { status: 400 });
    let scenarioId: string;
    try {
      if (body.scenario != null && typeof body.scenario !== 'string') throw new Error('scenario must be a string');
      scenarioId = resolveScenario(body.scenario).id;
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    const root = typeof body.ledgerRoot === 'string' ? body.ledgerRoot : String(body.evidence.at(-1)?.chainHash ?? '');
    const recorded = root ? findRecorded(root) : null;
    if (!recorded) return NextResponse.json({ error: 'This server has no record of that investigation; only runs and shared cases it holds can be replayed' }, { status: 404 });
    return NextResponse.json(await verifyLedger(body.evidence, scenarioId, buildCaseView(recorded.events).evidence));
  } catch {
    // Inputs are checked above; anything that still fails is ours, and its internals stay here.
    return NextResponse.json({ error: 'The proof could not be replayed' }, { status: 500 });
  }
}
