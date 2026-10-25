import { NextResponse } from 'next/server';
import { addComment, listComments } from '@/lib/cases';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ comments: listComments((await params).id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { exhibitId?: string | null; author?: string; role?: string; text?: string };
  try {
    return NextResponse.json(addComment((await params).id, { exhibitId: body.exhibitId, author: String(body.author ?? ''), role: body.role, text: String(body.text ?? '') }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
