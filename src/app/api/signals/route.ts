import { NextResponse } from 'next/server';
import { resolveScenario } from '@/lib/enterpriseData';
import { fetchAllFeeds } from '@/lib/signals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const scenario = resolveScenario(new URL(req.url).searchParams.get('scenario')).id;
    return NextResponse.json({ feeds: await fetchAllFeeds(scenario) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
