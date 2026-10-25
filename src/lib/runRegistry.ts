// Investigation runs live on the server independently of the HTTP stream that
// started them. That gives three guarantees:
//   - only one investigation runs at a time (a second request gets 409 and can attach),
//   - a client whose stream drops can catch up by polling the run's event log,
//   - a run that hangs is ended by a watchdog instead of holding the lock forever.
import crypto from 'node:crypto';
import { runInvestigation } from './investigation';
import type { InvestigationEvent, VisionFinding } from './investigation';
import { singleton } from './singleton';

export const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 240_000);

export interface Run {
  id: string;
  scenarioId: string;
  startedAt: number;
  finishedAt: number | null;
  events: InvestigationEvent[];
  listeners: Set<(e: InvestigationEvent) => void>;
}

const state = singleton('runs', () => ({ active: null as Run | null, recent: new Map<string, Run>() }));

export class BusyError extends Error {
  constructor(public run: Run) {
    super('An investigation is already running');
  }
}

export function activeRun(): Run | null {
  const r = state.active;
  return r && r.finishedAt === null ? r : null;
}

export function getRun(id: string): Run | undefined {
  return state.recent.get(id);
}

function push(run: Run, e: InvestigationEvent) {
  if (run.finishedAt !== null) return; // the watchdog may have closed it already
  run.events.push(e);
  for (const l of run.listeners) {
    try {
      l(e);
    } catch {
      run.listeners.delete(l); // a dead stream never blocks the run
    }
  }
  if (e.type === 'done' || (e.type === 'error' && !run.events.some((x) => x.type === 'done'))) {
    if (e.type === 'error') {
      // Close with a terminal event so pollers know the run is over.
      const done: InvestigationEvent = { type: 'done', ms: Date.now() - run.startedAt, evidence: [] };
      run.events.push(done);
      for (const l of run.listeners) l(done);
    }
    run.finishedAt = Date.now();
  }
}

export function startRun(scenarioId: string, vision: VisionFinding | null): Run {
  const busy = activeRun();
  if (busy) throw new BusyError(busy);
  const run: Run = { id: crypto.randomUUID(), scenarioId, startedAt: Date.now(), finishedAt: null, events: [], listeners: new Set() };
  state.active = run;
  state.recent.set(run.id, run);
  while (state.recent.size > 8) state.recent.delete(state.recent.keys().next().value!);

  const watchdog = setTimeout(() => push(run, { type: 'error', message: `Investigation timed out after ${RUN_TIMEOUT_MS / 1000}s` }), RUN_TIMEOUT_MS);
  runInvestigation((e) => push(run, e), { vision, scenarioId })
    .catch((err) => push(run, { type: 'error', message: (err as Error).message }))
    .finally(() => {
      clearTimeout(watchdog);
      if (run.finishedAt === null) push(run, { type: 'error', message: 'Investigation ended without a result' });
    });
  return run;
}

/**
 * Server-side evidence gate for actions: a remediation is allowed only for a
 * completed run (still in the registry) whose ledger root matches, whose gate
 * passed, and which confirmed every requested cause. The UI hides the button
 * otherwise; this makes the API enforce the same rule.
 */
export function authorizeRemediation(ledgerRoot: string, causes: { column: string; group: string; remedy: string }[]): { ok: true; run: Run } | { ok: false; reason: string } {
  for (const run of [...state.recent.values()].reverse()) {
    const ledger = run.events.find((e): e is Extract<InvestigationEvent, { type: 'ledger' }> => e.type === 'ledger');
    if (!ledger || ledger.root !== ledgerRoot) continue;
    if (run.finishedAt === null) return { ok: false, reason: 'The investigation is still running' };
    const gate = run.events.find((e): e is Extract<InvestigationEvent, { type: 'gate' }> => e.type === 'gate');
    if (!gate?.pass) return { ok: false, reason: 'The evidence gate did not pass for this investigation' };
    const action = run.events.find((e): e is Extract<InvestigationEvent, { type: 'action' }> => e.type === 'action');
    const confirmed = new Set((action?.plan.causes ?? []).map((c) => `${c.column}=${c.group}=${c.remedy}`));
    const extra = causes.find((c) => !confirmed.has(`${c.column}=${c.group}=${c.remedy}`));
    if (extra) return { ok: false, reason: `${extra.column}=${extra.group} was not confirmed by this investigation` };
    return { ok: true, run };
  }
  return { ok: false, reason: 'Unknown ledger root: run the investigation again before acting' };
}
