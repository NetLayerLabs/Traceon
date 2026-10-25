// Meterless context layer, built on the vendored reference engines:
//   - H-MEM (vendor/meterless-hmem): durable episodic memory of every weak
//     signal, hybrid retrieval to converge them, trust ledger for provenance,
//     and dreaming proposals that only become long-term memory on approval.
//   - Markovian (vendor/meterless-markovian): runs the investigation as a
//     bounded chain where each step only sees a compact carryover state.
//   - Lot world model: live risk state per lot, persisted next to H-MEM.
import fs from 'node:fs';
import path from 'node:path';
import { HMEM } from '../../vendor/meterless-hmem/src/index.ts';
import type { MemoryRecord } from '../../vendor/meterless-hmem/src/index.ts';
import { Markovian } from '../../vendor/meterless-markovian/src/index.ts';
import { AS_OF } from './enterpriseData';
import { singleton } from './singleton';

export const STORAGE_DIR =
  process.env.METERLESS_STORAGE_DIR || (process.env.VERCEL ? '/tmp/meterless-data' : path.join(process.cwd(), '.meterless-data'));

export interface IncomingSignal {
  id: string;
  channel: string; // e.g. 'warranty', 'Reddit r/ebikes', 'openFDA MAUDE'
  date: string; // YYYY-MM-DD
  city?: string;
  text: string;
  tags: string[];
}

export interface LotRiskState {
  lotId: string;
  signalCount: number;
  anomalyScore: number; // 0-100, derived from the lot's -log10(p)
  status: 'ACTIVE' | 'INVESTIGATING' | 'QUARANTINED';
  lastUpdated: string;
  note?: string;
}

let signalClock = Date.now();
const hmems = singleton('hmems', () => new Map<string, HMEM>());

/** Each scenario keeps its own memory so scenarios never contaminate each other. */
export function scenarioDir(scenarioId = 'reference'): string {
  return scenarioId === 'reference' ? STORAGE_DIR : path.join(STORAGE_DIR, 'scenarios', scenarioId);
}

function getHmem(scenarioId = 'reference'): HMEM {
  let mem = hmems.get(scenarioId);
  if (!mem) {
    mem = new HMEM({ persistDir: path.join(scenarioDir(scenarioId), 'hmem'), clock: () => signalClock, actor: 'traceon-agent' });
    hmems.set(scenarioId, mem);
  }
  return mem;
}

/** Ingest signals into H-MEM idempotently; returns how many were new. */
export function ingestSignals(signals: IncomingSignal[], scenarioId = 'reference'): { added: number; total: number } {
  const mem = getHmem(scenarioId);
  const known = new Set(mem.store.all().map((r) => r.source));
  let added = 0;
  for (const s of signals) {
    const source = `${s.channel}:${s.id}`;
    if (known.has(source)) continue;
    signalClock = Date.parse(s.date) || Date.now();
    mem.add({
      content: `${s.text}${s.city ? ` [${s.city}]` : ''}`,
      type: 'factual',
      layer: 'short_term',
      tags: ['sku:VR-48', `channel:${s.channel}`, ...s.tags],
      confidence: s.channel === 'warranty' ? 0.85 : 0.8,
      source,
      provenance: { origin: 'document', learnedAt: signalClock, label: s.channel, refs: [s.id] },
    });
    added++;
  }
  signalClock = Date.now();
  return { added, total: mem.store.all().length };
}

export interface Convergence {
  signature: string;
  matched: { id: string; source: string; content: string; relevance: number; date: string }[];
  channels: Record<string, number>;
  cities: Record<string, number>;
  firstSeen: string;
  lastSeen: string;
  priorInsights: { id: string; content: string; learnedAt: string }[];
  ledgerStats: Record<string, number>;
}

/** Use H-MEM hybrid retrieval to pull together weak signals sharing a symptom signature. */
export function convergeSignals(signature: string, scenarioId = 'reference'): Convergence {
  const mem = getHmem(scenarioId);
  // Score recency as of the dataset's date, not the wall clock, so the same
  // signals always converge the same way no matter when the demo is run.
  signalClock = Date.parse(`${AS_OF}T23:59:59Z`);
  const result = mem.query(signature, { topN: 400, threshold: 0.18 });
  const matched = result.memories
    .filter((m) => m.memory.layer !== 'long_term') // signals only; approved insights are reported separately
    .map((m) => ({
      id: m.memory.id,
      source: m.memory.source,
      content: m.memory.content,
      relevance: Number(m.relevance.toFixed(3)),
      date: new Date(m.memory.provenance.learnedAt).toISOString().slice(0, 10),
    }));
  const channels: Record<string, number> = {};
  const cities: Record<string, number> = {};
  for (const m of matched) {
    const ch = m.source.split(':')[0];
    channels[ch] = (channels[ch] ?? 0) + 1;
    const city = m.content.match(/\[([^\]]+)\]$/)?.[1];
    if (city) cities[city] = (cities[city] ?? 0) + 1;
  }
  const dates = matched.map((m) => m.date).sort();
  signalClock = Date.now();
  const priorInsights = mem.store
    .all()
    .filter((r: MemoryRecord) => r.layer === 'long_term' && r.tags.includes('insight:root-cause'))
    .map((r) => ({ id: r.id, content: r.content, learnedAt: new Date(r.timestamp).toISOString() }));
  return {
    signature,
    matched,
    channels,
    cities,
    firstSeen: dates[0] ?? '',
    lastSeen: dates[dates.length - 1] ?? '',
    priorInsights,
    ledgerStats: mem.ledger.stats(),
  };
}

/**
 * Propose a root-cause insight through H-MEM dreaming-style approval: the
 * finding is written to long-term memory only when a human approves the
 * quarantine, with lineage back to the signals that support it.
 */
export function commitRootCauseInsight(content: string, derivedFrom: string[], scenarioId = 'reference'): MemoryRecord {
  const mem = getHmem(scenarioId);
  const existing = mem.store.all().find((r) => r.layer === 'long_term' && r.content === content);
  if (existing) return existing;
  signalClock = Date.now();
  return mem.add({
    content,
    type: 'factual',
    layer: 'long_term',
    tags: ['insight:root-cause', 'sku:VR-48'],
    confidence: 0.95,
    source: 'traceon:human-approved-quarantine',
    provenance: { origin: 'sleep_synthesis', learnedAt: signalClock, label: 'approved by quality lead', refs: derivedFrom.slice(0, 20) },
    derivedFrom: derivedFrom.slice(0, 50),
  });
}

// ---------- Lot world model ----------
const worldFile = (scenarioId: string) => path.join(scenarioDir(scenarioId), 'lot-world-model.json');

export function readWorldModel(scenarioId = 'reference'): Record<string, LotRiskState> {
  try {
    return JSON.parse(fs.readFileSync(worldFile(scenarioId), 'utf-8'));
  } catch {
    return {};
  }
}

export function updateWorldModel(states: LotRiskState[], scenarioId = 'reference'): Record<string, LotRiskState> {
  const model = readWorldModel(scenarioId);
  for (const s of states) {
    const prev = model[s.lotId];
    // A quarantine is sticky: re-running an investigation never un-quarantines a lot.
    model[s.lotId] = prev?.status === 'QUARANTINED' ? { ...s, status: 'QUARANTINED', note: prev.note } : s;
  }
  try {
    fs.mkdirSync(scenarioDir(scenarioId), { recursive: true });
    fs.writeFileSync(worldFile(scenarioId), JSON.stringify(model, null, 2));
  } catch {
    // Read-only storage: the world model lasts for this call only.
  }
  return model;
}

/**
 * Clears demo memory only: H-MEM, the lot world model and per-scenario state.
 * Shared cases, uploaded datasets, the signing key and stamps, the scoreboard
 * and the NHTSA cache live in the same folder and are kept.
 */
export function resetMeterless() {
  for (const p of ['hmem', 'lot-world-model.json', 'scenarios']) fs.rmSync(path.join(STORAGE_DIR, p), { recursive: true, force: true });
  hmems.clear();
}

// ---------- Markovian bounded investigation chain ----------
export interface ChainStep {
  /** Runs one investigation step; returns display text plus the compact state to carry forward. */
  run: (carryover: string) => Promise<{ text: string; carryover: string }>;
}

export async function runBoundedChain(goal: string, steps: ChainStep[]) {
  const markovian = new Markovian({ chunkConfig: { chunkSize: 4000, maxChunks: Math.min(32, steps.length), carryoverTokens: 512 } });
  const run = await markovian.run({
    goal,
    mode: 'RESEARCH',
    reflect: false,
    stepFn: async ({ step, carryover }) => {
      const { text, carryover: next } = await steps[step].run(carryover);
      const done = step === steps.length - 1 ? '\n[TASK_COMPLETE]' : '';
      return { content: `${text}\n<CARRYOVER>${next}</CARRYOVER>${done}` };
    },
  });
  return {
    status: run.status,
    steps: run.chunks.length,
    carryoverTrail: run.chunks.map((c) => c.carryover),
    carryoverBudget: run.chunkConfig.carryoverTokens,
    maxCarryoverTokens: Math.max(0, ...run.chunks.map((c) => Math.ceil(c.carryover.length / 4))),
    tokensUsed: run.totalTokensUsed,
    tokensSaved: run.totalTokensSaved,
    efficiencyPercent: run.efficiencyPercent,
    tokenLabel: run.tokenLabel,
  };
}
