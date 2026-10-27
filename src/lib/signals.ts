// Signal ingestion: live U.S. federal safety feeds, Bright Data web signals,
// and internal warranty claims. Live feeds are never faked: if a feed is
// unreachable it comes back empty with status 'unreachable'.
import { getEnterpriseMesh, getSimulatedChatter, PRODUCT_NAME, resolveScenario } from './enterpriseData';
import { singleton } from './singleton';

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
  /** federal and news are real-world context; web and warranty are the product's own signals. */
  kind: 'federal' | 'web' | 'warranty' | 'news';
}

export interface FeedResult {
  feed: string;
  status: FeedStatus;
  note: string;
  items: RadarItem[];
}

const TIMEOUT = 9_000;

/**
 * Each federal feed's last live answer, kept here for 10 minutes rather than
 * in Next's fetch cache: that cache refuses openFDA's 2.5 MB reply (and logs
 * the URL), keeps an error body for 10 minutes, and serves day-old answers as
 * fresh when the network is down. A failure is never kept, so the next call
 * retries it, and nothing older than 10 minutes is served as live.
 */
const feedCache = singleton('feed-cache', () => new Map<string, { at: number; value: FeedResult }>());
const fresh = (key: string) => {
  const hit = feedCache.get(key);
  return hit && Date.now() - hit.at < 10 * 60_000 ? hit.value : null;
};
const keep = (key: string, value: FeedResult) => (feedCache.set(key, { at: Date.now(), value }), value);

async function getJson(url: string, init?: RequestInit): Promise<unknown | null> {
  // Sample mode (TRACEON_OFFLINE=1): every feed reports unreachable without a request.
  if (process.env.TRACEON_OFFLINE === '1') return null;
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const ymd = (s: string) => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10));

/** CPSC recalls for e-bike products: base-rate context for lithium pack fires. */
export async function fetchCpscEbikeRecalls(): Promise<FeedResult> {
  const hit = fresh('cpsc');
  if (hit) return hit;
  const data = await getJson('https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2025-01-01&ProductName=e-bike');
  if (!data) return { feed: 'CPSC SaferProducts', status: 'unreachable', note: 'Feed did not respond', items: [] };
  // Some upstream faults come back as HTTP 200 with one pseudo-recall ("Error
  // retrieving Recalls: ..."): only a row with a recall number and a date is a recall.
  const rows = (Array.isArray(data) ? (data as Array<Record<string, any>>) : []).filter((r) => r?.RecallNumber && /^\d{4}-\d{2}-\d{2}/.test(String(r.RecallDate ?? '')));
  if (!Array.isArray(data) || (data.length > 0 && !rows.length)) {
    const error = Array.isArray(data) ? String(data.find((r) => r?.Title)?.Title ?? '') : '';
    return { feed: 'CPSC SaferProducts', status: 'unreachable', note: error ? `Feed answered with an error: ${error.slice(0, 120)}` : 'Feed answered with no valid recalls', items: [] };
  }
  const items = rows
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
  return keep('cpsc', {
    feed: 'CPSC SaferProducts',
    status: 'live',
    note: `${items.length} e-bike recalls since 2025-01-01, ${fireCount} citing fire/burn hazard`,
    items,
  });
}

/**
 * openFDA MAUDE: lithium-battery thermal events in medical devices (a fire,
 * smoke, melting or thermal runaway from a lithium battery), the same failure
 * physics as a pack fire. Full-text search is loose ("lithium" also matches
 * lithium heparin), so each report's own narrative must name a lithium battery
 * and a thermal event (`isLithiumThermalEvent()`).
 */
const LITHIUM_BATTERY = /lithium[- ]?(ion|polymer)?\s*(battery|batteries|cell|pack)|\bli-?ion\b/i;
const THERMAL_EVENT = /caught fire|on fire|flames?\b|smok(e|ed|ing)\b|thermal runaway|melt(ed|ing)|burn(t|ed|ing)\b|explod/i;
const NOT_A_BATTERY = /heparin|lithium (carbonate|level|toxicity|dose)/i;
// A negation earlier in the same clause is not an event: test criteria ("the
// battery should not smoke, catch fire or explode") or "no occurrence of smoking".
const NEGATED = /\b(?:not|no|without|nor)\b(?:(?!\b(?:was|were|is|however|but|confirmed)\b)[^.;]){0,80}$/i;
const thermalMatches = (text: string) =>
  [...text.matchAll(new RegExp(THERMAL_EVENT.source, 'gi'))].filter((m) => !NEGATED.test(text.slice(Math.max(0, (m.index ?? 0) - 90), m.index)));

export function isLithiumThermalEvent(narrative: string) {
  return LITHIUM_BATTERY.test(narrative) && thermalMatches(narrative).length > 0 && !NOT_A_BATTERY.test(narrative);
}

export async function fetchOpenFdaBatteryEvents(): Promise<FeedResult> {
  const hit = fresh('openfda');
  if (hit) return hit;
  const key = process.env.OPENFDA_API_KEY ? `&api_key=${process.env.OPENFDA_API_KEY}` : '';
  const data = (await getJson(
    `https://api.fda.gov/device/event.json?search=mdr_text.text:%22lithium%22+AND+(mdr_text.text:%22fire%22+mdr_text.text:%22smoke%22+mdr_text.text:%22thermal+runaway%22+mdr_text.text:%22melted%22)&sort=date_received:desc&limit=100${key}`
  )) as { meta?: any; results?: any[] } | null;
  if (!data?.results) return { feed: 'openFDA MAUDE', status: 'unreachable', note: 'Feed did not respond', items: [] };
  const narrative = (r: any) => (r.mdr_text ?? []).map((m: any) => String(m.text ?? '')).join(' ');
  const kept = data.results.filter((r) => isLithiumThermalEvent(narrative(r)));
  const items = kept.slice(0, 12).map((r) => {
    const text = narrative(r);
    const at = Math.max(0, (thermalMatches(text)[0]?.index ?? 0) - 110);
    return {
      id: `MDR-${r.report_number ?? r.mdr_report_key}`,
      source: 'openFDA MAUDE',
      date: ymd(String(r.date_received ?? '')),
      title: `${r.device?.[0]?.generic_name ?? r.device?.[0]?.brand_name ?? 'Device'}`.slice(0, 80),
      detail: `${at ? '…' : ''}${text.slice(at, at + 260).replace(/\s+/g, ' ').trim()}`,
      url: `https://api.fda.gov/device/event.json?search=report_number:%22${encodeURIComponent(r.report_number ?? '')}%22`,
      tags: ['lithium-battery', 'thermal-event'],
      kind: 'federal' as const,
    };
  });
  return keep('openfda', {
    feed: 'openFDA MAUDE',
    status: 'live',
    note: `${kept.length} of the latest ${data.results.length} reports describe a lithium-battery fire, smoke or thermal runaway (medical devices)`,
    items,
  });
}

/**
 * NHTSA ODI: lithium traction-battery fire complaints on electric vehicles.
 * NHTSA covers motor vehicles only (e-bikes fall under CPSC, queried above),
 * so this is the closest public signal for a lithium pack fire: EVs with a
 * known battery-fire history, filtered strictly to complaints that report a
 * fire, involve no crash, name the battery (or charging) in the parts or the
 * narrative, and describe the fire in the narrative itself: NHTSA's fire flag
 * is also set on complaints that only discuss a fire recall.
 */
export const NHTSA_EVS: [string, string, number][] = [
  ['CHEVROLET', 'BOLT EV', 2017],
  ['CHEVROLET', 'BOLT EV', 2018],
  ['CHEVROLET', 'BOLT EV', 2019],
  ['HYUNDAI', 'KONA ELECTRIC', 2019],
  ['HYUNDAI', 'KONA ELECTRIC', 2020],
];
const BATTERY = /traction battery|high.?voltage battery|lithium|\bbatter(y|ies)\b|\bcells?\b|\bcharg(ing|er|ed)\b/i;
const FIRE_EVENT = /caught fire|on fire|flames?\b|smok(e|ed|ing)\b|thermal runaway|melt(ed|ing)|burn(t|ed|ing)?\b|explo(d|sion)/i;

/** A complaint that reports a battery fire with no crash involved. */
export function isBatteryFire(r: { fire?: boolean; crash?: boolean; components?: string; summary?: string }) {
  return Boolean(r.fire) && !r.crash && BATTERY.test(`${r.components ?? ''} ${r.summary ?? ''}`) && FIRE_EVENT.test(r.summary ?? '');
}

export async function fetchNhtsaBatteryFires(): Promise<FeedResult> {
  const hit = fresh('nhtsa');
  if (hit) return hit;
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
  const value: FeedResult = {
    feed: 'NHTSA ODI',
    status: 'live',
    note: `${relevant.length} lithium-battery fire complaints, no crash (Bolt EV, Kona Electric)${reached < answers.length ? `; ${answers.length - reached} of ${answers.length} queries unanswered` : ''}`,
    items,
  };
  // A partial answer is shown but not kept, so the missing queries are retried on the next call.
  return reached === answers.length ? keep('nhtsa', value) : value;
}
const toIso = (d: string) => {
  const [m, day, y] = String(d ?? '').split('/');
  return y ? `${y}-${m}-${day}` : '';
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bEv\b/, 'EV');

/**
 * Reviews and forum posts about the VoltRide VR-48. The product is fictional,
 * so no real posts about it exist: this is the scenario's simulated chatter,
 * always labelled simulated. It feeds H-MEM like the warranty claims.
 */
export async function fetchWebSignals(scenarioId = 'reference'): Promise<FeedResult> {
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
  return { feed: 'Web reviews & forums (VoltRide)', status: 'simulated', note: 'Simulated posts about the fictional VR-48; no real posts can exist', items };
}

/**
 * Bright Data Web Unlocker: real, current news on e-bike and lithium-battery
 * fires (Google News RSS fetched through Bright Data). Real-world context in
 * the radar, like the federal feeds; it never enters a case's evidence. One
 * request per 30 minutes at most, so judging costs cents of credit; after a
 * failure, one retry per 5 minutes. A call waits no longer than the federal
 * feeds do, and loads that arrive together share one request.
 */
const newsCache = singleton('bd-news', () => ({ at: 0, value: null as FeedResult | null, failUntil: 0, fail: null as FeedResult | null, pending: null as Promise<FeedResult> | null }));
export const NEWS_QUERY = '"e-bike" battery fire';

/** Forget every cached feed answer, so the next call asks again. */
export function resetFeedCache() {
  feedCache.clear();
  Object.assign(newsCache, { at: 0, value: null, failUntil: 0, fail: null, pending: null });
}

export function parseNewsRss(xml: string) {
  const text = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => {
      const get = (tag: string) => text(m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? '');
      const source = get('source');
      const title = get('title').replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      const date = new Date(get('pubDate'));
      return { title, link: get('link'), source, date: Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10) };
    })
    .filter((n) => n.title && n.date);
}

export async function fetchBrightDataNews(): Promise<FeedResult | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token || process.env.TRACEON_OFFLINE === '1') return null;
  if (newsCache.value && Date.now() - newsCache.at < 30 * 60_000) return newsCache.value;
  if (newsCache.fail && Date.now() < newsCache.failUntil) return newsCache.fail;
  newsCache.pending ??= requestNews(token).finally(() => (newsCache.pending = null));
  return newsCache.pending;
}

async function requestNews(token: string): Promise<FeedResult> {
  const target = `https://news.google.com/rss/search?q=${encodeURIComponent(NEWS_QUERY)}&hl=en-US&gl=US&ceid=US:en`;
  let xml: string | null = null;
  let reason = 'returned no articles';
  try {
    const res = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone: process.env.BRIGHTDATA_ZONE || 'web_unlocker1', url: target, format: 'raw' }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.ok) xml = await res.text();
    else reason = `answered HTTP ${res.status}`;
  } catch (err) {
    reason = /timeout|abort/i.test((err as Error)?.name ?? '') ? `did not answer within ${TIMEOUT / 1000} s` : 'could not be reached';
  }
  // Syndicated stories repeat under several outlets: keep the first of each headline.
  const seen = new Set<string>();
  const news = (xml ? parseNewsRss(xml) : [])
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((n) => {
      const k = n.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return !seen.has(k) && Boolean(seen.add(k));
    });
  if (!news.length) {
    const fail: FeedResult = { feed: 'Bright Data (news)', status: 'unreachable', note: `Bright Data ${reason}; next try in 5 minutes`, items: [] };
    Object.assign(newsCache, { fail, failUntil: Date.now() + 5 * 60_000 });
    return fail;
  }
  const value: FeedResult = {
    feed: 'Bright Data (news)',
    status: 'live',
    note: `${news.length} recent news reports of e-bike battery fires (Google News via Bright Data Web Unlocker)`,
    items: news.slice(0, 15).map((n, i) => ({
      id: `NEWS-${n.date}-${i}`,
      source: n.source || 'News',
      date: n.date,
      title: n.title.slice(0, 140),
      detail: `${n.source ? `${n.source}. ` : ''}Real-world report, context only.`,
      url: n.link,
      tags: symptomTags(n.title),
      kind: 'news' as const,
    })),
  };
  Object.assign(newsCache, { value, at: Date.now(), fail: null, failUntil: 0 });
  return value;
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
      tags: [...new Set([c.severity.toLowerCase(), ...symptomTags(c.symptom)])],
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
  const [cpsc, fda, nhtsa, web, news] = await Promise.all([
    fetchCpscEbikeRecalls(),
    fetchOpenFdaBatteryEvents(),
    fetchNhtsaBatteryFires(),
    fetchWebSignals(scenarioId),
    fetchBrightDataNews(),
  ]);
  return [fetchWarrantyClaims(scenarioId), web, cpsc, fda, nhtsa, ...(news ? [news] : [])];
}
