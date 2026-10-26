import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resolveScenario } from '@/lib/enterpriseData';
import { readWorldModel, scenarioDir } from '@/lib/meterless';
import { aiProviders, NEMOTRON_FAST_MODEL, NEMOTRON_MODEL, nemotronLive, NIGHTSHIFT_ROUTES, nightshiftStatus } from '@/lib/nemotron';
import { zetarisMode, zetarisParityCheck } from '@/lib/zetaris';

let parityCache: { at: number; value: Awaited<ReturnType<typeof zetarisParityCheck>> } | null = null;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  let scenarioId = 'reference';
  try {
    scenarioId = resolveScenario(new URL(req.url).searchParams.get('scenario')).id;
  } catch {}
  let memories = 0;
  try {
    memories = JSON.parse(fs.readFileSync(path.join(scenarioDir(scenarioId), 'hmem', 'state.json'), 'utf-8')).records.length;
  } catch {}
  const world = readWorldModel(scenarioId);
  // Probe the Zetaris cloud at most every 5 minutes; proves the cloud holds the demo data.
  if (zetarisMode() === 'ZETARIS_CLOUD' && (!parityCache || Date.now() - parityCache.at > 300_000)) {
    parityCache = { at: Date.now(), value: await zetarisParityCheck() };
  }
  return NextResponse.json({
    nemotron: { live: nemotronLive(), model: NEMOTRON_MODEL, fastModel: NEMOTRON_FAST_MODEL },
    ai: { providers: aiProviders(), nightshift: { ...(await nightshiftStatus()), routes: NIGHTSHIFT_ROUTES } },
    zetaris: { mode: zetarisMode(), host: process.env.ZETARIS_API_URL ? new URL(process.env.ZETARIS_API_URL).host : null, parity: parityCache?.value ?? null },
    meterless: { memories, quarantinedLots: Object.values(world).filter((l) => l.status === 'QUARANTINED').map((l) => l.lotId) },
    brightdata: { live: Boolean(process.env.BRIGHTDATA_API_TOKEN) },
  });
}
