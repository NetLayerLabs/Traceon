// Client-side investigation state, folded from the NDJSON event stream.
import type {
  ActionPlan,
  EvidenceItem,
  ForestRow,
  GateCriterion,
  HypothesisNode,
  InvestigationEvent,
  Reveal,
  RobustnessRow,
  VisionFinding,
} from '@/lib/investigation';

type Ev<T extends InvestigationEvent['type']> = Extract<InvestigationEvent, { type: T }>;

export interface InvState {
  running: boolean;
  runId: string | null;
  scenario: { id: string; label: string; blurb: string | null } | null;
  reveal: Reveal | null;
  phase: string;
  phaseLabel: string;
  phasesSeen: string[];
  feeds: Ev<'feeds'>['feeds'];
  convergence: Ev<'convergence'>['data'] | null;
  plan: Omit<Ev<'plan'>, 'type' | 'hypotheses'> | null;
  hypotheses: HypothesisNode[];
  evidence: EvidenceItem[];
  robustness: RobustnessRow[];
  forest: ForestRow[];
  granularity: Ev<'granularity'>['data'] | null;
  vision: Ev<'vision'>['data'] | null;
  redteam: Omit<Ev<'redteam'>, 'type'> | null;
  timeline: Ev<'timeline'>['data'] | null;
  gate: { pass: boolean; criteria: GateCriterion[]; blanket?: { units: number; costUsd: number } } | null;
  narrative: Omit<Ev<'narrative'>, 'type'> | null;
  action: ActionPlan | null;
  markovian: Ev<'markovian'>['data'] | null;
  ledger: { root: string; count: number } | null;
  logs: { text: string; tone?: string }[];
  doneMs: number | null;
  error: string | null;
}

export const initialState: InvState = {
  running: false,
  runId: null,
  scenario: null,
  reveal: null,
  phase: '',
  phaseLabel: '',
  phasesSeen: [],
  feeds: [],
  convergence: null,
  plan: null,
  hypotheses: [],
  evidence: [],
  robustness: [],
  forest: [],
  granularity: null,
  vision: null,
  redteam: null,
  timeline: null,
  gate: null,
  narrative: null,
  action: null,
  markovian: null,
  ledger: null,
  logs: [],
  doneMs: null,
  error: null,
};

export type Action =
  | { type: 'start'; runId?: string | null }
  | { type: 'runId'; runId: string }
  | { type: 'event'; event: InvestigationEvent }
  | { type: 'fail'; message: string };

export function reducer(s: InvState, a: Action): InvState {
  if (a.type === 'start') return { ...initialState, running: true, runId: a.runId ?? null, phase: 'ingest', phaseLabel: 'Starting…' };
  if (a.type === 'runId') return { ...s, runId: a.runId };
  if (a.type === 'fail') return { ...s, running: false, error: a.message };
  const e = a.event;
  switch (e.type) {
    case 'scenario':
      return { ...s, scenario: { id: e.id, label: e.label, blurb: e.blurb } };
    case 'reveal':
      return { ...s, reveal: e.data };
    case 'phase':
      return { ...s, phase: e.phase, phaseLabel: e.label, phasesSeen: s.phasesSeen.includes(e.phase) ? s.phasesSeen : [...s.phasesSeen, e.phase] };
    case 'log':
      return { ...s, logs: [...s.logs, { text: e.text, tone: e.tone }] };
    case 'feeds':
      return { ...s, feeds: e.feeds };
    case 'convergence':
      return { ...s, convergence: e.data };
    // The plan, red team and explanation keep every field their event carries,
    // such as whether the model's reply came from the cache.
    case 'plan': {
      const { type: _type, hypotheses, ...plan } = e;
      return { ...s, plan, hypotheses };
    }
    case 'hypothesis':
      return { ...s, hypotheses: s.hypotheses.map((h) => (h.id === e.node.id ? e.node : h)) };
    case 'evidence':
      return { ...s, evidence: [...s.evidence, e.item] };
    case 'robustness':
      return { ...s, robustness: e.data };
    case 'forest':
      return { ...s, forest: e.rows };
    case 'granularity':
      return { ...s, granularity: e.data };
    case 'vision':
      return { ...s, vision: e.data };
    case 'redteam': {
      const { type: _type, ...redteam } = e;
      return { ...s, redteam };
    }
    case 'timeline':
      return { ...s, timeline: e.data };
    case 'gate':
      return { ...s, gate: { pass: e.pass, criteria: e.criteria, blanket: e.blanket } };
    case 'narrative': {
      const { type: _type, ...narrative } = e;
      return { ...s, narrative };
    }
    case 'action':
      return { ...s, action: e.plan };
    case 'markovian':
      return { ...s, markovian: e.data };
    case 'ledger':
      return { ...s, ledger: { root: e.root, count: e.count } };
    case 'done':
      // A watchdog/error 'done' carries no evidence; keep what streamed in.
      return { ...s, running: false, doneMs: e.ms, phase: 'done', phaseLabel: s.error ? s.phaseLabel : `Investigation complete in ${(e.ms / 1000).toFixed(1)}s`, evidence: e.evidence.length ? e.evidence : s.evidence };
    case 'error':
      return { ...s, running: false, error: e.message };
    default:
      return s;
  }
}

export type { VisionFinding, EvidenceItem, HypothesisNode, ActionPlan, Reveal, ForestRow };

/** Fold a finished event log into state (reviewer mode, saved cases). */
export function foldEvents(events: InvestigationEvent[], runId: string | null = null): InvState {
  return events.reduce((s, event) => reducer(s, { type: 'event', event }), { ...initialState, runId });
}
