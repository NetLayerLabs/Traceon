// Real-recall time machine: replay public NHTSA complaint histories and ask
// when a standard safety-signal test would have flagged a fire defect,
// compared with the date the manufacturer actually recalled it.
//
// Method: disproportionality analysis, the signal-detection standard in drug
// and device safety (Evans et al., 2001). Complaints have no "units sold"
// denominator, so each vehicle's share of fire complaints for a component is
// compared with the same share across a pool of popular comparator vehicles.
// Signal: proportional reporting ratio (PRR) >= 2, Yates chi-square >= 4 and
// at least 3 cases. A lead time counts only if a fire-related recall exists
// for the same component.
import fs from 'node:fs';
import path from 'node:path';

export const CASES = [
  { id: 'bolt-ev', make: 'CHEVROLET', model: 'BOLT EV', years: [2017, 2018, 2019] },
  { id: 'kia-sorento', make: 'KIA', model: 'SORENTO', years: [2014, 2015, 2016, 2017, 2018] },
  { id: 'hyundai-santa-fe', make: 'HYUNDAI', model: 'SANTA FE', years: [2013, 2014, 2015, 2016, 2017, 2018] },
  { id: 'hyundai-kona-electric', make: 'HYUNDAI', model: 'KONA ELECTRIC', years: [2019, 2020] },
  { id: 'ford-escape', make: 'FORD', model: 'ESCAPE', years: [2013, 2014, 2015, 2016] },
] as const;

export const COMPARATORS: [string, string][] = [
  ['TOYOTA', 'CAMRY'],
  ['HONDA', 'CIVIC'],
  ['FORD', 'F-150'],
  ['TOYOTA', 'RAV4'],
  ['HONDA', 'CR-V'],
  ['CHEVROLET', 'EQUINOX'],
  ['NISSAN', 'LEAF'],
  ['TESLA', 'MODEL 3'],
  ['NISSAN', 'ROGUE'],
  ['JEEP', 'GRAND CHEROKEE'],
];

export const SIGNAL = { minCases: 3, minPrr: 2, minChi2: 4 } as const;

const cacheDir = () => path.join(process.env.METERLESS_STORAGE_DIR || path.join(process.cwd(), '.meterless-data'), 'nhtsa');

/** NHTSA dates: complaints use MM/DD/YYYY, recalls DD/MM/YYYY. */
const isoComplaint = (s: string) => {
  const [m, d, y] = s.split('/');
  return y ? `${y}-${m}-${d}` : s.slice(0, 10);
};
const isoRecall = (s: string) => {
  const [d, m, y] = s.split('/');
  return y ? `${y}-${m}-${d}` : s.slice(0, 10);
};

/** Component family: the first word of the top-level component ("FUEL/PROPULSION SYSTEM" -> FUEL). */
export function componentKey(c: string): string {
  return c.split(':')[0].trim().split(/[\s/,]+/)[0].toUpperCase();
}

export async function fetchNhtsa(kind: 'complaints' | 'recalls', make: string, model: string, year: number, rawDir?: string): Promise<any[]> {
  const probeName = `${kind === 'complaints' ? 'c' : 'r'}-${make}-${model}-${year}.json`.replace(/ /g, '_');
  if (rawDir && fs.existsSync(path.join(rawDir, probeName))) return JSON.parse(fs.readFileSync(path.join(rawDir, probeName), 'utf-8'));
  const cached = path.join(cacheDir(), probeName);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf-8'));
  const endpoint = kind === 'complaints' ? 'complaints/complaintsByVehicle' : 'recalls/recallsByVehicle';
  try {
    const res = await fetch(`https://api.nhtsa.gov/${endpoint}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`, { signal: AbortSignal.timeout(30_000) });
    // 400 means no such model year (cache the empty answer); 429 and 5xx are transient (do not).
    if (!res.ok && res.status !== 400 && res.status !== 404) return [];
    const rows = res.ok ? ((await res.json()).results ?? []) : [];
    try {
      fs.mkdirSync(cacheDir(), { recursive: true });
      fs.writeFileSync(cached, JSON.stringify(rows));
    } catch {}
    return rows;
  } catch {
    return [];
  }
}

export interface TargetComplaint {
  d: string; // filed date
  f: 0 | 1; // fire reported
  c: string[]; // component families
  o: string; // ODI number
  s: string; // summary excerpt
}

export function compactTarget(rows: any[]): TargetComplaint[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => !seen.has(String(r.odiNumber)) && seen.add(String(r.odiNumber)))
    .map((r) => ({
      d: isoComplaint(String(r.dateComplaintFiled)),
      f: r.fire ? 1 : 0,
      c: [...new Set(String(r.components ?? '').split(',').map((x) => componentKey(x)).filter(Boolean))],
      o: String(r.odiNumber),
      s: String(r.summary ?? '').replace(/\s+/g, ' ').slice(0, 220),
    }))
    .sort((a, b) => a.d.localeCompare(b.d)) as TargetComplaint[];
}

export interface ComparatorDay {
  d: string;
  n: number; // complaints filed that day
  f: number; // fire complaints that day
  fc: Record<string, number>; // fire complaints per component family
}

export function compactComparators(rows: any[]): ComparatorDay[] {
  const seen = new Set<string>();
  const days = new Map<string, ComparatorDay>();
  for (const r of rows) {
    if (seen.has(String(r.odiNumber))) continue;
    seen.add(String(r.odiNumber));
    const d = isoComplaint(String(r.dateComplaintFiled));
    const day = days.get(d) ?? { d, n: 0, f: 0, fc: {} };
    day.n++;
    if (r.fire) day.f++;
    if (r.fire) for (const c of new Set(String(r.components ?? '').split(',').map((x) => componentKey(x)).filter(Boolean))) day.fc[c] = (day.fc[c] ?? 0) + 1;
    days.set(d, day);
  }
  return [...days.values()].sort((a, b) => a.d.localeCompare(b.d));
}

export interface Snapshot {
  id: string;
  vehicle: string;
  years: number[];
  fetchedAt: string;
  source: string;
  complaints: TargetComplaint[];
  comparators: ComparatorDay[];
  comparatorVehicles: string[];
  recalls: { campaign: string; date: string; component: string; summary: string; consequence: string }[];
}

export function loadSnapshot(id: string): Snapshot | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'nhtsa', `${id}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

export async function liveSnapshot(make: string, model: string, years: number[]): Promise<Snapshot> {
  const complaints: any[] = [];
  const recalls: any[] = [];
  for (const y of years) {
    complaints.push(...(await fetchNhtsa('complaints', make, model, y)));
    recalls.push(...(await fetchNhtsa('recalls', make, model, y)));
  }
  const comp: any[] = [];
  for (const [mk, md] of COMPARATORS) for (const y of years) if (!(mk === make && md === model)) comp.push(...(await fetchNhtsa('complaints', mk, md, y)));
  const seen = new Set<string>();
  return {
    id: `live-${make}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    vehicle: `${make} ${model}`,
    years,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: 'api.nhtsa.gov (live)',
    complaints: compactTarget(complaints),
    comparators: compactComparators(comp),
    comparatorVehicles: COMPARATORS.map(([a, b]) => `${a} ${b}`),
    recalls: recalls
      .filter((r) => !seen.has(r.NHTSACampaignNumber) && seen.add(r.NHTSACampaignNumber))
      .map((r) => ({ campaign: r.NHTSACampaignNumber, date: r.ReportReceivedDate, component: r.Component, summary: String(r.Summary ?? '').slice(0, 400), consequence: String(r.Consequence ?? '').slice(0, 300) })),
  };
}

const yatesChi2 = (a: number, b: number, c: number, d: number) => {
  const n = a + b + c + d;
  const den = (a + b) * (c + d) * (a + c) * (b + d);
  return den > 0 ? ((Math.abs(a * d - b * c) - n / 2) ** 2 * n) / den : 0;
};

export interface ComponentSignal {
  component: string;
  fires: number; // fire complaints for this component, whole history
  alert: { date: string; cases: number; prr: number; chi2: number } | null;
  recall: { campaign: string; date: string; component: string; summary: string } | null;
  verdict: 'early' | 'late' | 'no-recall' | 'no-signal';
  leadDays: number | null;
}

export interface Backtest {
  id: string;
  vehicle: string;
  years: number[];
  fetchedAt: string;
  source: string;
  totals: { complaints: number; fires: number; comparatorComplaints: number; comparatorFires: number };
  headline: ComponentSignal | null;
  components: ComponentSignal[];
  series: { d: string; cases: number; prr: number; chi2: number }[]; // headline component, weekly
  firesBeforeAlert: TargetComplaint[];
  fireRecalls: { campaign: string; date: string; component: string; key: string; summary: string }[];
}

/** Replay the complaint history day by day and find each component's first signal. */
export function analyze(s: Snapshot): Backtest {
  type Ev = { d: string; target: boolean; n: number; fc: Record<string, number> };
  const events: Ev[] = [
    ...s.complaints.map((c) => ({ d: c.d, target: true, n: 1, fc: c.f ? Object.fromEntries(c.c.map((k) => [k, 1])) : {} })),
    ...s.comparators.map((c) => ({ d: c.d, target: false, n: c.n, fc: c.fc })),
  ].sort((x, y) => x.d.localeCompare(y.d) || Number(y.target) - Number(x.target));
  const comps = new Set<string>();
  for (const c of s.complaints) if (c.f) c.c.forEach((k) => k !== 'UNKNOWN' && comps.add(k));
  const tN = { all: 0 };
  const cN = { all: 0 };
  const tF: Record<string, number> = {};
  const cF: Record<string, number> = {};
  const alerts: Record<string, ComponentSignal['alert']> = {};
  const seriesByComp: Record<string, { d: string; cases: number; prr: number; chi2: number }[]> = {};
  let lastWeek: Record<string, string> = {};
  for (const e of events) {
    if (e.target) tN.all += e.n;
    else cN.all += e.n;
    for (const [k, v] of Object.entries(e.fc)) {
      if (e.target) tF[k] = (tF[k] ?? 0) + v;
      else cF[k] = (cF[k] ?? 0) + v;
    }
    for (const k of comps) {
      const a = tF[k] ?? 0;
      const b = tN.all - a;
      const c = cF[k] ?? 0;
      const d = cN.all - c;
      if (a + b === 0 || c + d === 0) continue;
      // With no comparator cases the PRR is unbounded; use a 0.5 continuity correction.
      const prr = (a / (a + b)) / (Math.max(c, 0.5) / (c + d));
      const chi2 = yatesChi2(a, b, c, d);
      const week = e.d.slice(0, 8) + String(Math.min(4, Math.floor((Number(e.d.slice(8, 10)) - 1) / 7))).padStart(1, '0');
      if (lastWeek[k] !== week) {
        (seriesByComp[k] ??= []).push({ d: e.d, cases: a, prr: Number(prr.toFixed(2)), chi2: Number(chi2.toFixed(2)) });
        lastWeek[k] = week;
      } else {
        const arr = seriesByComp[k];
        arr[arr.length - 1] = { d: e.d, cases: a, prr: Number(prr.toFixed(2)), chi2: Number(chi2.toFixed(2)) };
      }
      if (!alerts[k] && a >= SIGNAL.minCases && prr >= SIGNAL.minPrr && chi2 >= SIGNAL.minChi2) alerts[k] = { date: e.d, cases: a, prr: Number(prr.toFixed(1)), chi2: Number(chi2.toFixed(1)) };
    }
  }

  const fireRecalls = s.recalls
    .filter((r) => /FIRE/i.test(`${r.summary} ${r.consequence}`))
    .map((r) => ({ campaign: r.campaign, date: isoRecall(r.date), component: r.component, key: componentKey(r.component), summary: r.summary }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const components: ComponentSignal[] = [...comps]
    .map((k) => {
      const alert = alerts[k] ?? null;
      const recall = fireRecalls.find((r) => r.key === k) ?? null;
      let verdict: ComponentSignal['verdict'] = 'no-signal';
      let leadDays: number | null = null;
      if (alert && recall) {
        leadDays = Math.round((Date.parse(recall.date) - Date.parse(alert.date)) / 86_400_000);
        verdict = leadDays >= 0 ? 'early' : 'late';
      } else if (alert) verdict = 'no-recall';
      return { component: k, fires: tF[k] ?? 0, alert, recall: recall && { campaign: recall.campaign, date: recall.date, component: recall.component, summary: recall.summary }, verdict, leadDays };
    })
    .sort((a, b) => {
      const rank = { early: 0, late: 1, 'no-recall': 2, 'no-signal': 3 };
      return rank[a.verdict] - rank[b.verdict] || (a.alert?.date ?? '9').localeCompare(b.alert?.date ?? '9') || b.fires - a.fires;
    });

  const headline = components[0] ?? null;
  const firesBeforeAlert = headline?.alert ? s.complaints.filter((c) => c.f && c.d <= headline.alert!.date && c.c.includes(headline.component)) : [];
  return {
    id: s.id,
    vehicle: s.vehicle,
    years: s.years,
    fetchedAt: s.fetchedAt,
    source: s.source,
    totals: {
      complaints: s.complaints.length,
      fires: s.complaints.filter((c) => c.f).length,
      comparatorComplaints: s.comparators.reduce((a, d) => a + d.n, 0),
      comparatorFires: s.comparators.reduce((a, d) => a + (d.f ?? 0), 0),
    },
    headline,
    components,
    series: headline ? seriesByComp[headline.component] ?? [] : [],
    firesBeforeAlert,
    fireRecalls,
  };
}
