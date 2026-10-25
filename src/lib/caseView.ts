// Rebuilds a finished investigation from its event log. Shared by "Ask the
// case", the reports, reviewer mode and verification after the fix, so every
// one of them reads exactly what the agent produced.
import type { ActionPlan, EvidenceItem, ForestRow, GateCriterion, HypothesisNode, InvestigationEvent, Reveal, RobustnessRow } from './investigation';
import { getRun } from './runRegistry';
import { getCase } from './cases';

type Ev<T extends InvestigationEvent['type']> = Extract<InvestigationEvent, { type: T }>;

export interface CaseView {
  scenario: { id: string; label: string; blurb: string | null } | null;
  hypotheses: HypothesisNode[];
  plan: Ev<'plan'> | null;
  gate: { pass: boolean; criteria: GateCriterion[] } | null;
  action: ActionPlan | null;
  narrative: Ev<'narrative'> | null;
  redteam: Ev<'redteam'> | null;
  robustness: RobustnessRow[];
  timeline: Ev<'timeline'>['data'] | null;
  forest: ForestRow[];
  convergence: Ev<'convergence'>['data'] | null;
  vision: Ev<'vision'>['data'] | null;
  ledger: { root: string; count: number } | null;
  reveal: Reveal | null;
  evidence: EvidenceItem[];
  done: boolean;
}

export function buildCaseView(events: InvestigationEvent[]): CaseView {
  const last = <T extends InvestigationEvent['type']>(t: T) => [...events].reverse().find((e): e is Ev<T> => e.type === t) ?? null;
  const hyp = new Map<string, HypothesisNode>();
  for (const e of events) {
    if (e.type === 'plan') for (const h of e.hypotheses) hyp.set(h.id, h);
    if (e.type === 'hypothesis') hyp.set(e.node.id, e.node);
  }
  const scenario = last('scenario');
  const gate = last('gate');
  const done = last('done');
  return {
    scenario: scenario && { id: scenario.id, label: scenario.label, blurb: scenario.blurb },
    hypotheses: [...hyp.values()],
    plan: last('plan'),
    gate: gate && { pass: gate.pass, criteria: gate.criteria },
    action: last('action')?.plan ?? null,
    narrative: last('narrative'),
    redteam: last('redteam'),
    robustness: last('robustness')?.data ?? [],
    timeline: last('timeline')?.data ?? null,
    forest: last('forest')?.rows ?? [],
    convergence: last('convergence')?.data ?? null,
    vision: last('vision')?.data ?? null,
    ledger: (() => {
      const l = last('ledger');
      return l && { root: l.root, count: l.count };
    })(),
    reveal: last('reveal')?.data ?? null,
    evidence: done?.evidence.length ? done.evidence : events.filter((e): e is Ev<'evidence'> => e.type === 'evidence').map((e) => e.item),
    done: Boolean(done),
  };
}

/** Events of a run still in the registry, or of a case saved for review. */
export function loadEvents(id: string): InvestigationEvent[] | null {
  const run = getRun(id);
  if (run) return run.events;
  const saved = getCase(id);
  return saved ? saved.events : null;
}
