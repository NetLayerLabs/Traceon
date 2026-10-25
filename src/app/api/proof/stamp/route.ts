import { NextResponse } from 'next/server';
import { buildCaseView, loadEvents } from '@/lib/caseView';
import { readStamp, stampRoot, verifySignature } from '@/lib/stamp';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST {id}: sign and timestamp the ledger root of a finished run or case.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const events = body.id ? loadEvents(body.id) : null;
  if (!events) return NextResponse.json({ error: 'Unknown investigation' }, { status: 404 });
  const view = buildCaseView(events);
  if (!view.ledger || !view.scenario) return NextResponse.json({ error: 'The investigation has not finished' }, { status: 409 });
  try {
    return NextResponse.json(await stampRoot(view.ledger.root, view.scenario.id, view.ledger.count));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

// GET ?root=<hex>[&file=statement|ots] returns the stamp or one of its files.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const stamp = readStamp(url.searchParams.get('root') ?? '');
  if (!stamp) return NextResponse.json({ stamp: null });
  const file = url.searchParams.get('file');
  const name = `traceon-${stamp.root.slice(0, 12)}`;
  if (file === 'statement') return new Response(stamp.statement, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.txt"` } });
  if (file === 'ots' && stamp.ots) return new Response(new Uint8Array(Buffer.from(stamp.ots.file, 'base64')), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}.txt.ots"` } });
  return NextResponse.json({ ...stamp, signatureValid: verifySignature(stamp.statement, stamp.signature, stamp.key.pem) });
}
