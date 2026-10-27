import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resolveScenario } from '@/lib/enterpriseData';
import { readWorldModel, resetEnabled, scenarioDir } from '@/lib/meterless';
import { aiProviders, NEMOTRON_FAST_MODEL, NEMOTRON_MODEL, nightshiftStatus, pickNightshiftModel } from '@/lib/nemotron';
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
  const providers = aiProviders();
  const nightshift = await nightshiftStatus();
  // The model each job asks Nightshift for, picked from the list it serves. A
  // model it does not list (the photo, while Nightshift has no vision lane) is
  // not served there; NIM answers instead when it is configured.
  const routes = nightshift.routes.length
    ? Object.fromEntries(
        (['vision', 'fast', 'deep'] as const).map((job) => {
          const id = pickNightshiftModel(job, nightshift.routes);
          return [job, nightshift.routes.includes(id) ? id : `${id} (not listed${providers.includes('nim') ? '; NIM answers' : ''})`];
        })
      )
    : null;
  // Nemotron answers on NIM, or through Nightshift when the models it serves for these jobs are Nemotron.
  const viaNightshift = providers.includes('nightshift') ? [...new Set(Object.values(routes ?? {}).filter((m) => nightshift.routes.includes(m) && /nemotron/i.test(m)))] : [];
  return NextResponse.json({
    nemotron: { live: providers.includes('nim') || viaNightshift.length > 0, model: NEMOTRON_MODEL, fastModel: NEMOTRON_FAST_MODEL, viaNightshift },
    ai: { providers, nightshift: { ...nightshift, listed: nightshift.routes, routes } },
    zetaris: { mode: zetarisMode(), host: process.env.ZETARIS_API_URL ? new URL(process.env.ZETARIS_API_URL).host : null, parity: parityCache?.value ?? null },
    meterless: { memories, quarantinedLots: Object.values(world).filter((l) => l.status === 'QUARANTINED').map((l) => l.lotId) },
    brightdata: { live: Boolean(process.env.BRIGHTDATA_API_TOKEN) },
    // Same rule as POST /api/reset, so the app can hide the button.
    resetDisabled: !resetEnabled(),
  });
}
