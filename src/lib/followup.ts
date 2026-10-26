// Verification after the fix. A remediation is a prediction: if the cause is
// right, failures fall back to the baseline and no factor concentrates them
// any more. This simulates the 30 days after the fix on the scenario's own
// hazards (seeded from the proof root, so it is repeatable) and checks the
// pre-registered falsifiers. It is a simulation, labelled as such in the UI;
// with real data the same checks run on the claims that actually arrive.
import crypto from 'node:crypto';
import type { CaseView } from './caseView';
import { getEnterpriseMesh } from './enterpriseData';
import { DIMENSIONS, REMEDY, REMEDY_FOR } from './investigation';
import type { RemedyKind } from './investigation';
import { chiSquareIndependence, formatP, hottestGroup } from './stats';

export const FOLLOWUP_DAYS = 30;

export interface FollowUpResult {
  mode: 'planned' | 'wrong-fix';
  simulated: true;
  applied: { column: string; group: string; remedy: RemedyKind; label: string; units: number }[];
  days: { day: number; failures: number }[];
  newFailures: number;
  expectedBaseline: number;
  checks: { id: string; label: string; pass: boolean; detail: string }[];
  verdict: 'verified' | 'reopen';
  summary: string;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** P(X >= k) for X ~ Poisson(mu). */
function poissonUpperTail(k: number, mu: number) {
  if (k <= 0) return 1;
  let term = Math.exp(-mu);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= mu / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

export function simulateFollowUp(view: CaseView, mode: 'planned' | 'wrong-fix'): FollowUpResult {
  if (!view.scenario || !view.action?.causes.length || !view.ledger) throw new Error('Follow-up needs a finished investigation with a confirmed cause');
  const mesh = getEnterpriseMesh(view.scenario.id);
  const dims = mesh.dimensions ?? DIMENSIONS;
  const rows = mesh.units as unknown as Record<string, unknown>[];
  const inGroup = (u: Record<string, unknown>, c: { column: string; group: string }) => String(u[c.column]) === c.group;
  const causes = view.action.causes;
  const remedyOf = (column: string): RemedyKind => REMEDY_FOR[column] ?? (mesh.custom ? 'QUARANTINE' : 'ADVISORY');

  // Observed hazards per day: each confirmed cause group, and everything else.
  const days = (u: Record<string, unknown>) => (mesh.capabilities.daysInField ? Math.max(1, Number(u.days_in_field) || 1) : 30);
  const hazard = (pick: (u: Record<string, unknown>) => boolean) => {
    let f = 0;
    let exposure = 0;
    for (const u of rows) if (pick(u)) (f += Number(u.failed)), (exposure += days(u));
    return exposure ? f / exposure : 0;
  };
  const h0 = hazard((u) => !causes.some((c) => inGroup(u, c)));
  const hc = causes.map((c) => hazard((u) => inGroup(u, c)));

  // What gets fixed: the plan, or the most tempting wrong answer.
  let applied: { column: string; group: string; remedy: RemedyKind }[];
  if (mode === 'planned') applied = causes.map((c) => ({ column: c.column, group: c.group, remedy: c.remedy }));
  else {
    const candidates = view.hypotheses
      .filter((h) => h.hotGroup && !causes.some((c) => c.hypothesisId === h.id) && (h.status === 'CONFOUNDED' || h.status === 'SIGNIFICANT' || h.rawRR))
      .map((h) => {
        const column = dims.find((d) => d.id === h.id)?.column ?? '';
        const remedy = remedyOf(column);
        const neutralises = remedy !== 'ADVISORY';
        // Cause units this wrong fix would leave at risk.
        const leftAtRisk = rows.filter((u) => causes.some((c) => inGroup(u, c)) && !(neutralises && String(u[column]) === h.hotGroup)).length;
        return { h, column, remedy, leftAtRisk, confounded: h.status === 'CONFOUNDED' };
      })
      .filter((c) => c.column)
      .sort((a, b) => Number(b.confounded) - Number(a.confounded) || b.leftAtRisk - a.leftAtRisk || (b.h.rawRR?.rr ?? 0) - (a.h.rawRR?.rr ?? 0));
    const pick = candidates[0];
    if (!pick) throw new Error('No alternative suspect to act on');
    applied = [{ column: pick.column, group: pick.h.hotGroup!, remedy: pick.remedy }];
  }
  const held = (u: Record<string, unknown>) => applied.some((a) => a.remedy === 'QUARANTINE' && inGroup(u, a));
  const neutralised = (u: Record<string, unknown>) => applied.some((a) => a.remedy !== 'ADVISORY' && inGroup(u, a));

  // Simulate 30 days on the units still in the field.
  const rand = mulberry32(parseInt(crypto.createHash('sha256').update(`${view.ledger.root}:${mode}`).digest('hex').slice(0, 8), 16));
  const daily = new Array<number>(FOLLOWUP_DAYS).fill(0);
  const failedNew = new Uint8Array(rows.length);
  let atRisk = 0;
  rows.forEach((u, i) => {
    if (held(u)) return;
    atRisk++;
    let h = h0;
    if (!neutralised(u)) causes.forEach((c, j) => inGroup(u, c) && (h = Math.max(h, hc[j])));
    if (rand() < 1 - Math.exp(-h * FOLLOWUP_DAYS)) {
      failedNew[i] = 1;
      daily[Math.floor(rand() * FOLLOWUP_DAYS)]++;
    }
  });
  const newFailures = daily.reduce((a, b) => a + b, 0);
  const expectedBaseline = h0 * FOLLOWUP_DAYS * atRisk;

  // Check 1: the failure rate returns to the baseline (exact Poisson test).
  const pExcess = poissonUpperTail(newFailures, expectedBaseline);
  const checks: FollowUpResult['checks'] = [
    {
      id: 'baseline',
      label: 'Failures back to the baseline rate',
      pass: pExcess >= 0.01,
      detail: `${newFailures} new failures in ${FOLLOWUP_DAYS} days; ${expectedBaseline.toFixed(1)} expected at the baseline rate (excess p ${pExcess < 1e-15 ? '< 1e-15' : pExcess < 1e-4 ? `= ${pExcess.toExponential(1)}` : `= ${pExcess.toFixed(3)}`})`,
    },
  ];
  // Check 2: re-screen every factor on the new failures. A cause that is still
  // active shows up as a concentration again.
  const alpha = 0.01 / dims.length;
  let worst: { title: string; group: string; p: number; label: string } | null = null;
  for (const d of dims) {
    const g = new Map<string, { units: number; failures: number }>();
    rows.forEach((u, i) => {
      if (held(u)) return;
      const key = String(u[d.column]);
      const cur = g.get(key) ?? { units: 0, failures: 0 };
      cur.units++;
      cur.failures += failedNew[i];
      g.set(key, cur);
    });
    const groups = [...g.entries()].map(([group, v]) => ({ group, ...v }));
    if (groups.length < 2 || !newFailures) continue;
    const t = chiSquareIndependence(groups);
    const hot = hottestGroup(t.groups);
    if (!worst || t.p < worst.p) worst = { title: d.title, group: hot.group, p: t.p, label: formatP(t.p, t.negLog10P) };
  }
  checks.push({
    id: 'residual',
    label: 'No factor concentrates the new failures',
    pass: !worst || worst.p >= alpha,
    detail: worst ? `Strongest: ${worst.title} ${worst.group} (${worst.label}; bar ${alpha.toExponential(1)})` : 'No new failures to screen',
  });

  const verdict = checks.every((c) => c.pass) ? 'verified' : 'reopen';
  const appliedOut = applied.map((a) => ({ ...a, label: REMEDY[a.remedy].label, units: rows.filter((u) => inGroup(u, a)).length }));
  const what = appliedOut.map((a) => `${a.label.toLowerCase()} of ${a.column.replace(/_/g, ' ')} ${a.group}`).join(' and ');
  const summary =
    verdict === 'verified'
      ? `After the ${what}, failures fell to the baseline rate and no factor concentrates them. The fix is verified; the case can close.`
      : `After the ${what}, failures did not return to the baseline${worst && worst.p < alpha ? `: ${worst.title} ${worst.group} still concentrates them` : ''}. The fix did not hold; the case is reopened.`;
  return { mode, simulated: true, applied: appliedOut, days: daily.map((failures, i) => ({ day: i + 1, failures })), newFailures, expectedBaseline, checks, verdict, summary };
}
