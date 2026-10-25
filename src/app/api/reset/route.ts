import { NextResponse } from 'next/server';
import { resetMeterless } from '@/lib/meterless';
import { activeRun } from '@/lib/runRegistry';
import { resetMirrorHolds } from '@/lib/zetaris';

export const runtime = 'nodejs';

// Clears durable memory and ERP holds so a demo can start fresh.
export async function POST() {
  if (activeRun()) return NextResponse.json({ error: 'An investigation is running' }, { status: 409 });
  resetMeterless();
  resetMirrorHolds();
  return NextResponse.json({ ok: true });
}
