import { NextResponse } from 'next/server';
import { addComment, getCase, listComments } from '@/lib/cases';
import { readJson } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getCase(id)) return NextResponse.json({ error: 'Unknown case' }, { status: 404 });
  return NextResponse.json({ comments: listComments(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const raw = await readJson<{ exhibitId?: string | null; author?: string; role?: string; text?: string }>(req);
  if (raw instanceof Response) return raw;
  const body = (raw ?? {}) as { exhibitId?: string | null; author?: string; role?: string; text?: string };
  const { id } = await params;
  if (!getCase(id)) return NextResponse.json({ error: 'Unknown case' }, { status: 404 });
  try {
    return NextResponse.json(addComment(id, { exhibitId: body.exhibitId, author: String(body.author ?? ''), role: typeof body.role === 'string' ? body.role : undefined, text: String(body.text ?? '') }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
