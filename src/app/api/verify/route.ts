import { NextResponse } from 'next/server';
import { verifyLedger } from '@/lib/actions';
import { resolveScenario } from '@/lib/enterpriseData';
import type { EvidenceItem } from '@/lib/investigation';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { evidence, scenario } = ((await req.json().catch(() => ({}))) ?? {}) as { evidence?: EvidenceItem[]; scenario?: string };
  if (!Array.isArray(evidence)) return NextResponse.json({ error: 'evidence array required' }, { status: 400 });
  try {
    return NextResponse.json(await verifyLedger(evidence, resolveScenario(scenario).id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
