import { NextResponse } from 'next/server';
import { executeRemediation } from '@/lib/actions';
import type { RemediationRequest } from '@/lib/actions';
import { readJson } from '@/lib/http';
import { authorizeRemediation } from '@/lib/runRegistry';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await readJson<RemediationRequest>(req);
  if (body instanceof Response) return body;
  const ok = (c: unknown) => !!c && typeof c === 'object' && ['column', 'group', 'remedy'].every((k) => typeof (c as Record<string, unknown>)[k] === 'string');
  if (!Array.isArray(body?.causes) || !body.causes.length || !body.causes.every(ok) || typeof body.approvedBy !== 'string' || !body.approvedBy.trim() || typeof body.ledgerRoot !== 'string') {
    return NextResponse.json({ error: 'causes, approvedBy and ledgerRoot are required' }, { status: 400 });
  }
  // The evidence gate is enforced here too, not just by hiding the button.
  const auth = authorizeRemediation(body.ledgerRoot, body.causes);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
  try {
    return NextResponse.json(await executeRemediation({ ...body, scenario: auth.scenarioId }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
