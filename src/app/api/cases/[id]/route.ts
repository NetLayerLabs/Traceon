import { NextResponse } from 'next/server';
import { getCase, listComments } from '@/lib/cases';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getCase(id);
  if (!c) return NextResponse.json({ error: 'Unknown case' }, { status: 404 });
  return NextResponse.json({ ...c, comments: listComments(id) });
}
