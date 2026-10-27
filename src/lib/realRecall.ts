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
  return (await lookupNhtsa(kind, make, model, year, rawDir)).rows;
}

/**
 * One NHTSA lookup. `ok` is false when NHTSA did not answer (timeout, 429,
 * 5xx), which is not the same as answering with nothing (400 or 404: no such
 * vehicle or model year under that name). Only answers with rows are cached:
 * an empty one may be a model year NHTSA adds later.
 */
async function lookupNhtsa(kind: 'complaints' | 'recalls', make: string, model: string, year: number, rawDir?: string, deadline = Infinity): Promise<{ rows: any[]; ok: boolean }> {
  const probeName = `${kind === 'complaints' ? 'c' : 'r'}-${make}-${model}-${year}.json`.replace(/ /g, '_');
  if (rawDir && fs.existsSync(path.join(rawDir, probeName))) return { rows: JSON.parse(fs.readFileSync(path.join(rawDir, probeName), 'utf-8')), ok: true };
  const cached = path.join(cacheDir(), probeName);
  try {
    const rows = JSON.parse(fs.readFileSync(cached, 'utf-8'));
    if (Array.isArray(rows) && rows.length) return { rows, ok: true };
  } catch {}
  const left = deadline - Date.now();
  if (left <= 0) return { rows: [], ok: false };
  const endpoint = kind === 'complaints' ? 'complaints/complaintsByVehicle' : 'recalls/recallsByVehicle';
  try {
    const res = await fetch(`https://api.nhtsa.gov/${endpoint}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`, { signal: AbortSignal.timeout(Math.min(30_000, left)) });
    if (res.status === 400 || res.status === 404) return { rows: [], ok: true };
    if (!res.ok) return { rows: [], ok: false };
    const rows: any[] = (await res.json()).results ?? [];
    if (rows.length) {
      try {
        fs.mkdirSync(cacheDir(), { recursive: true });
        fs.writeFileSync(cached, JSON.stringify(rows));
      } catch {}
    }
    return { rows, ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

/** Run `fn` over `items`, at most `limit` at a time; results keep the order of `items`. */
async function inPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
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
  /** Live runs: requested model years NHTSA has no complaints for under this name. */
  missingYears?: number[];
  /** Live runs: comparator model years missing from the pool ("FORD F-150 2021"). */
  comparatorGaps?: string[];
}

export function loadSnapshot(id: string): Snapshot | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'nhtsa', `${id}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

/** A live replay fetches four lookups at a time and stops asking after two minutes, well inside the request's limit. */
const LIVE_BUDGET_MS = 120_000;

/**
 * Fetches the vehicle's complaints and recalls and the comparator pool. Throws
 * if NHTSA did not answer for the vehicle itself; years and comparators NHTSA
 * has nothing for are listed in the snapshot (and its source line), not hidden.
 */
export async function liveSnapshot(make: string, model: string, years: number[]): Promise<Snapshot> {
  if (process.env.TRACEON_OFFLINE === '1') throw new Error('live lookups are off in sample mode (TRACEON_OFFLINE=1); the bundled vehicles replay offline');
  const deadline = Date.now() + LIVE_BUDGET_MS;
  type Job = { kind: 'complaints' | 'recalls'; make: string; model: string; year: number; target: boolean };
  const jobs: Job[] = [
    ...years.flatMap((year): Job[] => [
      { kind: 'complaints', make, model, year, target: true },
      { kind: 'recalls', make, model, year, target: true },
    ]),
    ...COMPARATORS.filter(([mk, md]) => !(mk === make && md === model)).flatMap(([mk, md]) => years.map((year): Job => ({ kind: 'complaints', make: mk, model: md, year, target: false }))),
  ];
  const answers = await inPool(jobs, 4, (j) => lookupNhtsa(j.kind, j.make, j.model, j.year, undefined, deadline));
  const unanswered = jobs.filter((j, i) => j.target && !answers[i].ok);
  if (unanswered.length) throw new Error(`no answer from api.nhtsa.gov for ${make} ${model} (${unanswered.map((j) => `${j.year} ${j.kind}`).join(', ')}); try again in a minute`);
  const rowsOf = (pick: (j: Job) => boolean) => jobs.flatMap((j, i) => (pick(j) ? answers[i].rows : []));
  const complaints = rowsOf((j) => j.target && j.kind === 'complaints');
  const recalls = rowsOf((j) => j.target && j.kind === 'recalls');
  const comp = rowsOf((j) => !j.target);
  const missingYears = years.filter((y) => !jobs.some((j, i) => j.target && j.kind === 'complaints' && j.year === y && answers[i].rows.length));
  const comparatorGaps = jobs.flatMap((j, i) => (!j.target && !answers[i].rows.length ? [`${j.make} ${j.model} ${j.year}${answers[i].ok ? '' : ' (no answer)'}`] : []));
  const gaps = [missingYears.length ? `no complaints under this name for ${missingYears.join(', ')}` : '', comparatorGaps.length ? `comparators missing: ${comparatorGaps.join(', ')}` : ''].filter(Boolean);
  const seen = new Set<string>();
  return {
    id: `live-${make}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    vehicle: `${make} ${model}`,
    years: years.filter((y) => !missingYears.includes(y)),
    missingYears,
    comparatorGaps,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: `api.nhtsa.gov (live)${gaps.map((g) => `; ${g}`).join('')}`,
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
  /** After each fire recall of the headline component: did the fix hold? */
  followUp?: RecallFollowUp[];
  /** Live runs: what NHTSA had nothing for (see Snapshot). */
  missingYears?: number[];
  comparatorGaps?: string[];
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
    ...(s.missingYears ? { missingYears: s.missingYears, comparatorGaps: s.comparatorGaps } : {}),
  };
}

// ---------- After the recall: did the fix hold? ----------

export interface RecallFollowUp {
  campaign: string;
  date: string;
  summary: string;
  before: { days: number; fires: number };
  /** Fires while the remedy was still reaching owners (the lag window). */
  rollout: { days: number; fires: number };
  /** The year after the lag; `complaints` counts every complaint, a check that owners kept reporting. */
  after: { days: number; fires: number; complaints: number };
  /** One-sided exact test that fires became rarer after the recall (conditional binomial on the two counts). */
  pDecrease: number;
  nextRecall: { campaign: string; date: string } | null;
  verdict: 'held' | 'did-not-hold' | 'too-few';
  reason: string;
}

/** P(X <= k) for X ~ Binomial(n, p). */
function binomCdf(k: number, n: number, p: number) {
  if (k >= n) return 1;
  let term = Math.pow(1 - p, n);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    sum += term;
  }
  return Math.min(1, sum);
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * DAY_MS).toISOString().slice(0, 10);

/**
 * For each fire recall of the backtest's headline component, compare fire
 * complaints in the year after the recall with the year before. A fix that
 * holds shows significantly fewer; one that does not keeps them coming,
 * often followed by another recall of the same component. Complaints are
 * dated by filing, remedies take months to reach owners, and publicity after
 * a recall raises reporting, so this is evidence, not proof.
 */
export function recallFollowUp(s: Snapshot, bt: Backtest, windowDays = 365, lagDays = 90): RecallFollowUp[] {
  const h = bt.headline;
  if (!h) return [];
  const recalls = bt.fireRecalls.filter((r) => r.key === h.component);
  const fires = s.complaints.filter((c) => c.f && c.c.includes(h.component)).map((c) => c.d).sort();
  const lastData = [...s.complaints.map((c) => c.d), ...s.comparators.map((c) => c.d)].sort().at(-1) ?? s.fetchedAt;
  return recalls.map((r, i) => {
    const next = recalls.slice(i + 1).find((x) => x.date > r.date) ?? null;
    // Remedies take months to reach owners: the year after is counted from the end of a lag.
    const beforeStart = addDays(r.date, -windowDays);
    const afterStart = addDays(r.date, lagDays);
    const afterEnd = [addDays(afterStart, windowDays), lastData].sort()[0];
    const afterDays = Math.max(1, Math.round((Date.parse(afterEnd) - Date.parse(afterStart)) / DAY_MS));
    const before = fires.filter((d) => d >= beforeStart && d < r.date).length;
    const rollout = fires.filter((d) => d >= r.date && d < afterStart).length;
    const after = fires.filter((d) => d >= afterStart && d < afterEnd).length;
    const complaintsAfter = s.complaints.filter((c) => c.d >= afterStart && c.d < afterEnd).length;
    const n = before + after;
    const pDecrease = n ? binomCdf(after, n, afterDays / (afterDays + windowDays)) : 1;
    const soonNext = next && Date.parse(next.date) - Date.parse(r.date) <= 2 * 365 * DAY_MS ? next : null;
    let verdict: RecallFollowUp['verdict'];
    let reason: string;
    if (after >= 3 && pDecrease >= 0.05) {
      verdict = 'did-not-hold';
      reason = `${after} fire complaints in the year from ${lagDays} days after the recall, against ${before} in the year before (no significant drop, p = ${pDecrease.toFixed(2)})${soonNext ? `; another fire recall of the same component followed on ${soonNext.date} (${soonNext.campaign})` : ''}.`;
    } else if (n >= 4 && pDecrease < 0.05) {
      verdict = 'held';
      reason = `${after} fire complaints in the year from ${lagDays} days after the recall, against ${before} in the year before (significant drop, p = ${pDecrease < 0.001 ? pDecrease.toExponential(1) : pDecrease.toFixed(3)}), while owners kept filing other complaints (${complaintsAfter}).`;
    } else {
      verdict = 'too-few';
      reason = `${before} fire complaints in the year before and ${after} in the year after the lag: too few to tell.`;
    }
    return { campaign: r.campaign, date: r.date, summary: r.summary, before: { days: windowDays, fires: before }, rollout: { days: lagDays, fires: rollout }, after: { days: afterDays, fires: after, complaints: complaintsAfter }, pDecrease, nextRecall: next && { campaign: next.campaign, date: next.date }, verdict, reason };
  });
}
