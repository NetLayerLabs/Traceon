// Live watch mode: replay the warranty stream day by day and screen every
// factor the way a monitoring job would. The screen only says "something is
// concentrating"; when it fires, a full investigation is opened on the data as
// it stood that day (scenario id `<id>@<date>`), and that investigation decides
// whether there is a cause or only a confounder.
import { DIMENSIONS } from './investigation';
import { getEnterpriseMesh, resolveScenario } from './enterpriseData';
import { chiSquareIndependence, hottestGroup } from './stats';

export const WATCH_ALPHA = 0.01;
export const WATCH_MIN_FAILURES = 5;

export interface WatchDay {
  date: string;
  units: number;
  claims: number;
  newClaims: number;
  /** Strongest factor that day: -log10 p of its chi-square screen. */
  top: { id: string; title: string; group: string; negLog10P: number; failures: number } | null;
}

export interface WatchReplay {
  scenarioId: string;
  label: string;
  threshold: number; // -log10 of the Bonferroni alpha
  days: WatchDay[];
  alert: { date: string; id: string; title: string; group: string; claims: number; caseId: string } | null;
}

const cache = new Map<string, WatchReplay>();
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function watchReplay(scenarioId: string): WatchReplay {
  const scenario = resolveScenario(scenarioId);
  if (scenario.asOf || scenario.custom) throw new Error('Watch mode replays a generated scenario from the start');
  const hit = cache.get(scenario.id);
  if (hit) return hit;
  const mesh = getEnterpriseMesh(scenario.id);
  const dims = mesh.dimensions ?? DIMENSIONS;
  const threshold = -Math.log10(WATCH_ALPHA / dims.length);

  // Encode each unit's group per factor once; then accumulate day by day.
  const groupIdx = dims.map(() => new Map<string, number>());
  const codes = dims.map(() => new Int32Array(mesh.units.length));
  const serialIndex = new Map<string, number>();
  mesh.units.forEach((u, i) => {
    serialIndex.set(u.serial, i);
    dims.forEach((d, k) => {
      const v = String((u as unknown as Record<string, unknown>)[d.column]);
      let g = groupIdx[k].get(v);
      if (g === undefined) groupIdx[k].set(v, (g = groupIdx[k].size));
      codes[k][i] = g;
    });
  });
  const names = groupIdx.map((m) => [...m.keys()]);
  const units = names.map((n) => new Array<number>(n.length).fill(0));
  const fails = names.map((n) => new Array<number>(n.length).fill(0));

  const byShip = mesh.units.map((u, i) => [u.ship_date, i] as const).sort((a, b) => a[0].localeCompare(b[0]));
  const claims = [...mesh.claims].sort((a, b) => a.filed_date.localeCompare(b.filed_date));
  const first = claims[0]?.filed_date ?? mesh.asOf;
  const start = Date.parse(byShip[0]?.[0] ?? first);
  const end = Date.parse(mesh.asOf);

  const days: WatchDay[] = [];
  let ui = 0;
  let ci = 0;
  let alert: WatchReplay['alert'] = null;
  for (let t = start; t <= end; t += DAY) {
    const date = iso(t);
    while (ui < byShip.length && byShip[ui][0] <= date) {
      const i = byShip[ui][1];
      for (let k = 0; k < dims.length; k++) units[k][codes[k][i]]++;
      ui++;
    }
    let newClaims = 0;
    while (ci < claims.length && claims[ci].filed_date <= date) {
      const i = serialIndex.get(claims[ci].serial);
      if (i !== undefined) for (let k = 0; k < dims.length; k++) fails[k][codes[k][i]]++;
      ci++;
      newClaims++;
    }
    let top: WatchDay['top'] = null;
    if (ci >= WATCH_MIN_FAILURES) {
      for (let k = 0; k < dims.length; k++) {
        const groups = names[k].map((g, j) => ({ group: g, units: units[k][j], failures: fails[k][j] })).filter((g) => g.units > 0);
        if (groups.length < 2) continue;
        const test = chiSquareIndependence(groups);
        const hot = hottestGroup(test.groups);
        if (!top || test.negLog10P > top.negLog10P) top = { id: dims[k].id, title: dims[k].title, group: hot.group, negLog10P: test.negLog10P, failures: hot.failures };
      }
    }
    days.push({ date, units: ui, claims: ci, newClaims, top });
    if (!alert && top && top.negLog10P >= threshold && top.failures >= WATCH_MIN_FAILURES) {
      alert = { date, id: top.id, title: top.title, group: top.group, claims: ci, caseId: `${scenario.id}@${date}` };
    }
  }
  const replay: WatchReplay = { scenarioId: scenario.id, label: scenario.hidden ? 'Hidden scenario' : scenario.label, threshold, days, alert };
  cache.set(scenario.id, replay);
  if (cache.size > 6) cache.delete(cache.keys().next().value!);
  return replay;
}
