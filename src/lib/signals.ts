// Signal ingestion: live U.S. federal safety feeds, Bright Data web signals,
// and internal warranty claims. Live feeds are never faked: if a feed is
// unreachable it comes back empty with status 'unreachable'.
import { getEnterpriseMesh, getSimulatedChatter, PRODUCT_NAME, resolveScenario } from './enterpriseData';

export type FeedStatus = 'live' | 'unreachable' | 'simulated' | 'uploaded';

export interface RadarItem {
  id: string;
  source: string;
  date: string;
  title: string;
  detail: string;
  url?: string;
  tags: string[];
  city?: string;
  kind: 'federal' | 'web' | 'warranty';
}

export interface FeedResult {
  feed: string;
  status: FeedStatus;
  note: string;
  items: RadarItem[];
}

const TIMEOUT = 9_000;

async function getJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), next: { revalidate: 600 } } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const ymd = (s: string) => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10));

/** CPSC recalls for e-bike products: base-rate context for lithium pack fires. */
export async function fetchCpscEbikeRecalls(): Promise<FeedResult> {
  const data = (await getJson(
    'https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2025-01-01&ProductName=e-bike'
  )) as Array<Record<string, any>> | null;
  if (!data) return { feed: 'CPSC SaferProducts', status: 'unreachable', note: 'Feed did not respond', items: [] };
  const items = data
    .sort((a, b) => String(b.RecallDate).localeCompare(String(a.RecallDate)))
    .map((r) => {
      const hazards: string[] = (r.Hazards ?? []).map((h: any) => String(h.Name ?? ''));
      const text = `${r.Title} ${hazards.join(' ')}`.toLowerCase();
      const fire = /fire|burn|thermal|overheat/.test(text);
      return {
        id: `CPSC-${r.RecallNumber}`,
        source: 'CPSC SaferProducts',
        date: String(r.RecallDate).slice(0, 10),
        title: String(r.Title ?? 'CPSC recall'),
        detail: hazards.join('; ') || String(r.Description ?? '').slice(0, 200),
        url: r.URL,
        tags: fire ? ['fire-hazard', 'e-bike'] : ['e-bike'],
        kind: 'federal' as const,
      };
    });
  const fireCount = items.filter((i) => i.tags.includes('fire-hazard')).length;
  return {
    feed: 'CPSC SaferProducts',
    status: 'live',
    note: `${items.length} e-bike recalls since 2025-01-01, ${fireCount} citing fire/burn hazard`,
    items,
  };
}

/** openFDA MAUDE: battery overheat device reports (adjacent lithium-cell failure modes). */
export async function fetchOpenFdaBatteryEvents(): Promise<FeedResult> {
  const key = process.env.OPENFDA_API_KEY ? `&api_key=${process.env.OPENFDA_API_KEY}` : '';
  const data = (await getJson(
    `https://api.fda.gov/device/event.json?search=mdr_text.text:%22battery%22+AND+mdr_text.text:%22overheat%22&sort=date_received:desc&limit=12${key}`
  )) as { meta?: any; results?: any[] } | null;
  if (!data?.results) return { feed: 'openFDA MAUDE', status: 'unreachable', note: 'Feed did not respond', items: [] };
  const items = data.results.map((r) => ({
    id: `MDR-${r.report_number ?? r.mdr_report_key}`,
    source: 'openFDA MAUDE',
    date: ymd(String(r.date_received ?? '')),
    title: `${r.device?.[0]?.brand_name ?? 'Device'} (${r.device?.[0]?.manufacturer_d_name ?? 'unknown mfr'})`,
    detail: String(r.mdr_text?.[0]?.text ?? '').slice(0, 260),
    url: `https://api.fda.gov/device/event.json?search=report_number:%22${encodeURIComponent(r.report_number ?? '')}%22`,
    tags: ['battery', 'overheat', String(r.event_type ?? '').toLowerCase()],
    kind: 'federal' as const,
  }));
  return {
    feed: 'openFDA MAUDE',
    status: 'live',
    note: `${data.meta?.results?.total ?? items.length} battery-overheat device reports on file`,
    items,
  };
}

/**
 * NHTSA ODI: lithium traction-battery fire complaints on electric vehicles.
 * NHTSA covers motor vehicles only (e-bikes fall under CPSC, queried above),
 * so this is the closest public signal for a lithium pack fire: EVs with a
 * known battery-fire history, filtered strictly to complaints that report a
 * fire, involve no crash, and name the battery in the parts or the narrative.
 */
export const NHTSA_EVS: [string, string, number][] = [
  ['CHEVROLET', 'BOLT EV', 2017],
  ['CHEVROLET', 'BOLT EV', 2018],
  ['CHEVROLET', 'BOLT EV', 2019],
  ['HYUNDAI', 'KONA ELECTRIC', 2019],
  ['HYUNDAI', 'KONA ELECTRIC', 2020],
];
const BATTERY = /traction battery|high.?voltage battery|lithium|battery (pack|cell|module)|\bcells?\b/i;

/** A complaint that reports a battery fire with no crash involved. */
export function isBatteryFire(r: { fire?: boolean; crash?: boolean; components?: string; summary?: string }) {
  return Boolean(r.fire) && !r.crash && BATTERY.test(`${r.components ?? ''} ${r.summary ?? ''}`);
}

export async function fetchNhtsaBatteryFires(): Promise<FeedResult> {
  const answers = await Promise.all(
    NHTSA_EVS.map(([make, model, year]) =>
      getJson(`https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`).then(
        (d) => ({ vehicle: `${model} ${year}`, results: (d as { results?: any[] } | null)?.results ?? null })
      )
    )
  );
  if (answers.every((a) => a.results === null)) return { feed: 'NHTSA ODI', status: 'unreachable', note: 'Feed did not respond', items: [] };
  const relevant = answers
    .flatMap((a) => (a.results ?? []).filter(isBatteryFire).map((r) => ({ ...r, vehicle: a.vehicle })))
    .sort((a, b) => toIso(b.dateComplaintFiled).localeCompare(toIso(a.dateComplaintFiled)));
  const items = relevant.slice(0, 10).map((r) => ({
    id: `ODI-${r.odiNumber}`,
    source: 'NHTSA ODI',
    date: toIso(r.dateComplaintFiled),
    title: `${titleCase(r.vehicle)} · ${String(r.components).split(',')[0].toLowerCase()}`.slice(0, 80),
    detail: String(r.summary ?? '').slice(0, 260),
    tags: ['fire', 'lithium-battery'],
    kind: 'federal' as const,
  }));
  const reached = answers.filter((a) => a.results !== null).length;
  return {
    feed: 'NHTSA ODI',
    status: 'live',
    note: `${relevant.length} lithium-battery fire complaints, no crash (Bolt EV, Kona Electric)${reached < answers.length ? `; ${answers.length - reached} of ${answers.length} queries unanswered` : ''}`,
    items,
  };
}
const toIso = (d: string) => {
  const [m, day, y] = String(d ?? '').split('/');
  return y ? `${y}-${m}-${day}` : '';
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bEv\b/, 'EV');

/**
 * Bright Data Web Unlocker. With BRIGHTDATA_API_TOKEN set, fetches a Reddit
 * search for the product; otherwise returns the simulated chatter set,
 * explicitly labeled as simulated.
 */
export async function fetchWebSignals(scenarioId = 'reference'): Promise<FeedResult> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  // Live scraping only makes sense for the reference story; other scenarios are simulated end to end.
  if (token && scenarioId === 'reference') {
    const target = `https://www.reddit.com/search.json?q=${encodeURIComponent('"VR-48" battery')}&sort=new&limit=25`;
    const data = (await getJson('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone: process.env.BRIGHTDATA_ZONE || 'web_unlocker1', url: target, format: 'raw' }),
    })) as { data?: { children?: any[] } } | null;
    const posts = data?.data?.children ?? [];
    if (posts.length) {
      return {
        feed: 'Bright Data (Reddit)',
        status: 'live',
        note: `${posts.length} live posts`,
        items: posts.map((p) => ({
          id: `BD-${p.data.id}`,
          source: `Reddit r/${p.data.subreddit}`,
          date: new Date(p.data.created_utc * 1000).toISOString().slice(0, 10),
          title: p.data.title,
          detail: String(p.data.selftext ?? '').slice(0, 260),
          url: `https://reddit.com${p.data.permalink}`,
          tags: symptomTags(`${p.data.title} ${p.data.selftext}`),
          kind: 'web' as const,
        })),
      };
    }
  }
  const items = getSimulatedChatter(scenarioId).map((c) => ({
    id: c.id,
    source: c.channel,
    date: c.date,
    title: c.rating ? `${c.rating}-star review` : 'Forum post',
    detail: c.text,
    city: c.city,
    tags: symptomTags(c.text),
    kind: 'web' as const,
  }));
  return {
    feed: 'Bright Data (web reviews & forums)',
    status: 'simulated',
    note: token && scenarioId === 'reference' ? 'Live fetch returned no posts; showing simulated set' : token ? 'Simulated chatter for this scenario' : 'No BRIGHTDATA_API_TOKEN; simulated chatter for fictional SKU',
    items,
  };
}

export function fetchWarrantyClaims(scenarioId = 'reference'): FeedResult {
  const { claims } = getEnterpriseMesh(scenarioId);
  return {
    feed: resolveScenario(scenarioId).custom ? 'Uploaded failures' : 'Warranty claims (Salesforce silo)',
    status: resolveScenario(scenarioId).custom ? 'uploaded' : 'simulated',
    note: resolveScenario(scenarioId).custom ? `${claims.length} failures in the uploaded data` : `${claims.length} thermal claims for ${PRODUCT_NAME} (simulated enterprise data)`,
    items: claims.map((c) => ({
      id: c.claim_id,
      source: 'warranty',
      date: c.filed_date,
      title: `${c.severity} · ${c.serial}`,
      detail: c.narrative,
      city: c.region,
      tags: [c.severity.toLowerCase(), ...symptomTags(c.symptom)],
      kind: 'warranty' as const,
    })),
  };
}

export function symptomTags(text: string): string[] {
  const t = text.toLowerCase();
  const tags: string[] = [];
  if (/connector|pin/.test(t)) tags.push('connector');
  if (/scorch|burn|melt|black|brown|discolor/.test(t)) tags.push('scorch');
  if (/smoke|fire/.test(t)) tags.push('smoke');
  if (/hot|heat|overheat|warm/.test(t)) tags.push('overheat');
  if (/swell|bulge/.test(t)) tags.push('swelling');
  return tags;
}

export async function fetchAllFeeds(scenarioId = 'reference'): Promise<FeedResult[]> {
  // Uploaded data is someone else's product: the e-bike federal context does not apply.
  if (resolveScenario(scenarioId).custom) return [fetchWarrantyClaims(scenarioId)];
  const [cpsc, fda, nhtsa, web] = await Promise.all([
    fetchCpscEbikeRecalls(),
    fetchOpenFdaBatteryEvents(),
    fetchNhtsaBatteryFires(),
    fetchWebSignals(scenarioId),
  ]);
  return [fetchWarrantyClaims(scenarioId), web, cpsc, fda, nhtsa];
}
