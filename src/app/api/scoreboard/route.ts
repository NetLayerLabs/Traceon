import { NextResponse } from 'next/server';
import { summarizeScoreboard } from '@/lib/scoreboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(summarizeScoreboard());
}
