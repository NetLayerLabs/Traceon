import { NextResponse } from 'next/server';
import { buildCaseView, loadEvents } from '@/lib/caseView';
import { eightD, supplierPacket } from '@/lib/reports';

export const runtime = 'nodejs';

// GET ?id=<run or case>&kind=supplier|8d returns a printable HTML document.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const events = loadEvents(url.searchParams.get('id') ?? '');
  if (!events) return NextResponse.json({ error: 'Unknown investigation; run it again or share it as a case first' }, { status: 404 });
  const view = buildCaseView(events);
  if (!view.done) return NextResponse.json({ error: 'The investigation is still running' }, { status: 409 });
  try {
    const html = url.searchParams.get('kind') === 'supplier' ? supplierPacket(view) : eightD(view);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
