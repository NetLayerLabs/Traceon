import { NextResponse } from 'next/server';
import { OTS_CALENDARS, publicKey } from '@/lib/stamp';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ ...publicKey(), calendars: OTS_CALENDARS });
}
