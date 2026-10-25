import { NextResponse } from 'next/server';
import { executeRemediation } from '@/lib/actions';
import type { RemediationRequest } from '@/lib/actions';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as RemediationRequest | null;
  if (!body?.causes?.length || !body.approvedBy?.trim() || !body.ledgerRoot) {
    return NextResponse.json({ error: 'causes, approvedBy and ledgerRoot are required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await executeRemediation(body));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
