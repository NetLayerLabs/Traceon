import { NextResponse } from 'next/server';
import { watchReplay } from '@/lib/watch';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    return NextResponse.json(watchReplay(new URL(req.url).searchParams.get('scenario') || 'reference'));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
