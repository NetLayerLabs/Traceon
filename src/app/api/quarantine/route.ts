import { NextResponse } from 'next/server';
import { executeRemediation } from '@/lib/actions';
import type { RemediationRequest } from '@/lib/actions';
import { authorizeRemediation } from '@/lib/runRegistry';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RemediationRequest | null;
  if (!body?.causes?.length || !body.approvedBy?.trim() || !body.ledgerRoot) {
    return NextResponse.json({ error: 'causes, approvedBy and ledgerRoot are required' }, { status: 400 });
  }
  // The evidence gate is enforced here too, not just by hiding the button.
  const auth = authorizeRemediation(body.ledgerRoot, body.causes);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
  try {
    return NextResponse.json(await executeRemediation({ ...body, scenario: auth.run.scenarioId }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
