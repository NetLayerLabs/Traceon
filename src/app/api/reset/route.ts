import { NextResponse } from 'next/server';
import { resetEnabled, resetMeterless } from '@/lib/meterless';
import { activeRun } from '@/lib/runRegistry';
import { resetMirrorHolds } from '@/lib/zetaris';

export const runtime = 'nodejs';

// Clears demo memory and ERP holds so a demo can start fresh. Off on a
// production server unless TRACEON_ENABLE_RESET=1, so nobody can clear what
// other visitors of a shared deployment see (resetEnabled in meterless.ts).
export async function POST() {
  if (activeRun()) return NextResponse.json({ error: 'An investigation is running' }, { status: 409 });
  if (!resetEnabled()) return NextResponse.json({ error: 'Reset is disabled on this deployment' }, { status: 403 });
  resetMeterless();
  resetMirrorHolds();
  return NextResponse.json({ ok: true });
}
