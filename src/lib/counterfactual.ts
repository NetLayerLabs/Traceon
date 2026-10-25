// Counterfactual simulator ("what if"): the inputs the browser needs to re-run
// the statistics live. The math itself stays in stats.ts, which runs in both
// places, so the sliders use exactly the tests the agent used.
import type { CaseView } from './caseView';
import { getEnterpriseMesh } from './enterpriseData';
import type { GroupCount } from './stats';

export interface CounterfactualCause {
  id: string;
  title: string;
  column: string;
  group: string;
  /** The raw k×2 table the agent tested for this factor. */
  groups: GroupCount[];
  /** Incidents in the cause units per filing date. */
  claimsByDay: { date: string; claims: number }[];
  units: number;
  failures: number;
}

export interface CounterfactualInputs {
  scenarioId: string;
  alpha: number;
  hypotheses: number;
  asOf: string;
  firstClaim: string | null;
  alertDate: string | null;
  projected30d: number;
  causes: CounterfactualCause[];
}

export function counterfactualInputs(view: CaseView): CounterfactualInputs | null {
  if (!view.scenario || !view.action?.causes.length) return null;
  const mesh = getEnterpriseMesh(view.scenario.id);
  const k = Math.max(1, view.hypotheses.length);
  const unitBySerial = new Map(mesh.units.map((u) => [u.serial, u as unknown as Record<string, unknown>]));
  const causes: CounterfactualCause[] = view.action.causes.map((c) => {
    const node = view.hypotheses.find((h) => h.id === c.hypothesisId);
    const byDay = new Map<string, number>();
    for (const cl of mesh.claims) {
      const u = unitBySerial.get(cl.serial);
      if (u && String(u[c.column]) === c.group) byDay.set(cl.filed_date, (byDay.get(cl.filed_date) ?? 0) + 1);
    }
    return {
      id: c.hypothesisId,
      title: c.title,
      column: c.column,
      group: c.group,
      groups: (node?.rawTest?.groups ?? []).map((g) => ({ group: g.group, units: g.units, failures: g.failures })),
      claimsByDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, claims]) => ({ date, claims })),
      units: c.units,
      failures: c.failures,
    };
  });
  const dates = mesh.claims.map((c) => c.filed_date).sort();
  return {
    scenarioId: view.scenario.id,
    alpha: 0.01 / k,
    hypotheses: k,
    asOf: mesh.asOf,
    firstClaim: dates[0] ?? null,
    alertDate: view.timeline?.alertDate ?? null,
    projected30d: view.action.projectedIncidents30d,
    causes,
  };
}
