import { NextResponse } from 'next/server';
import { resetMeterless } from '@/lib/meterless';
import { activeRun } from '@/lib/runRegistry';
import { resetMirrorHolds } from '@/lib/zetaris';

export const runtime = 'nodejs';

// Clears demo memory and ERP holds so a demo can start fresh. Set
// TRACEON_DISABLE_RESET=1 on a shared deployment to turn it off.
export async function POST() {
  if (process.env.TRACEON_DISABLE_RESET === '1') return NextResponse.json({ error: 'Reset is disabled on this deployment' }, { status: 403 });
  if (activeRun()) return NextResponse.json({ error: 'An investigation is running' }, { status: 409 });
  resetMeterless();
  resetMirrorHolds();
  return NextResponse.json({ ok: true });
}
