// The Traceon investigation agent. Division of labor:
//   - Nemotron plans (ranks hypotheses), red-teams the verdict, inspects the
//     photo and writes the explanation. It never produces a statistic.
//   - Deterministic code runs every SQL query and every test, and decides
//     what is ruled out, what is confounded and what is confirmed.
//   - Meterless H-MEM converges weak signals; Markovian bounds the chain.
//   - Every piece of evidence is hashed into an append-only proof chain.
// The agent supports zero, one or several independent causes, and never sees
// the scenario's ground truth; that is only compared after the verdict.
import crypto from 'node:crypto';
import { AS_OF, getEnterpriseMesh, PRODUCT_NAME, scenarioTruth, SKU, UNIT_COST_USD } from './enterpriseData';
import { convergeSignals, ingestSignals, readWorldModel, runBoundedChain, updateWorldModel } from './meterless';
import type { Convergence, IncomingSignal } from './meterless';
import { aiName, aiPrimaryName, extractJson, nemotronChat, NEMOTRON_FAST_MODEL, NO_PROVIDER } from './nemotron';
import { recordScore } from './scoreboard';
import { fetchAllFeeds } from './signals';
import type { FeedResult } from './signals';
import { chiSquareIndependence, cochranMantelHaenszel, formatP, poissonInterval, relativeRisk, wilson } from './stats';
import type { CmhResult, IndependenceTest, Stratum } from './stats';
import { runFederatedQuery, SILO_CATALOG } from './zetaris';
import type { FederatedQueryResult } from './zetaris';

// ---------- Types shared with the UI ----------
export type HypothesisStatus = 'QUEUED' | 'TESTING' | 'NO_ASSOCIATION' | 'SIGNIFICANT' | 'CONFOUNDED' | 'CONFIRMED';

export interface Dimension {
  id: string;
  column: string;
  title: string;
  claim: string; // what the hypothesis asserts
  silo: string;
}

export const DIMENSIONS: Dimension[] = [
  { id: 'H-FW', column: 'firmware', title: 'Firmware overcharge bug', claim: 'A BMS firmware release overcharges cells', silo: 'Telemetry (firmware)' },
  { id: 'H-CARRIER', column: 'carrier', title: 'Carrier transit shock', claim: 'Rough handling by one carrier damages packs in transit', silo: 'WMS (shipments)' },
  { id: 'H-HEAT', column: 'climate_zone', title: 'Sun Belt heat exposure', claim: 'High ambient heat in Sun Belt markets drives thermal events', silo: 'WMS (warehouses)' },
  { id: 'H-PLANT', column: 'plant_id', title: 'Plant assembly defect', claim: 'One assembly plant has a process defect', silo: 'ERP (production lots)' },
  { id: 'H-BMS', column: 'bms_supplier', title: 'BMS board supplier', claim: 'A battery-management board supplier ships faulty boards', silo: 'Supplier BOM' },
  { id: 'H-SUPPLIER', column: 'cell_supplier', title: 'Cell supplier quality', claim: 'One cell supplier has systemic quality problems', silo: 'Supplier BOM' },
  { id: 'H-BATCH', column: 'cell_batch', title: 'Defective cell batch', claim: 'A specific incoming cell batch is defective', silo: 'Supplier BOM x ERP' },
];

export interface HypothesisNode {
  id: string;
  title: string;
  claim: string;
  rationale: string;
  priority: number;
  status: HypothesisStatus;
  silo: string;
  hotGroup?: string;
  rawTest?: IndependenceTest & { pLabel: string };
  /** Hottest group vs everything else on raw data, with a 95% interval. */
  rawRR?: { rr: number; lo: number; hi: number };
  adjusted?: { controlFor: string; controlLabel: string; pLabel: string; p: number; commonOddsRatio: number; aliased?: boolean }[];
  verdict?: string;
  evidenceIds: string[];
}

export interface EvidenceItem {
  id: string;
  kind: 'sql' | 'stat' | 'vision' | 'memory' | 'model' | 'feed';
  label: string;
  summary: string;
  query?: FederatedQueryResult;
  payload?: unknown;
  proofHash: string;
  chainHash: string;
}

export interface VisionFinding {
  /** Server-side id; investigations accept only findings this server produced. */
  id?: string;
  live: boolean;
  model: string;
  physicalFailureMode: string;
  suspectedComponent: string;
  severityScore: number;
  isManufacturingDefectLikely: boolean;
  visualEvidenceSummary: string;
  bbox?: { x: number; y: number; w: number; h: number };
  reasoning?: string;
}

export interface GateCriterion {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  /** Not assessable with this data (e.g. no symptom column); excluded from the gate. */
  na?: boolean;
}

/** A measurable condition that would overturn a confirmed cause (feature: falsifiers). */
export interface Falsifier {
  id: 'baseline' | 'signature' | 'subgroups' | 'residual';
  label: string;
  rule: string;
  threshold: number | null;
  current: number | null;
  unit: string;
}

/** One row of the forest plot: a suspect's relative risk with its 95% interval. */
export interface ForestRow {
  id: string;
  title: string;
  status: HypothesisStatus;
  group: string;
  rr: number;
  lo: number;
  hi: number;
  adjustedP?: string;
}

export type RemedyKind = 'QUARANTINE' | 'OTA_ROLLBACK' | 'CARRIER_INSPECTION' | 'ADVISORY';

export const REMEDY: Record<RemedyKind, { label: string; costPerUnit: number; verb: string }> = {
  QUARANTINE: { label: 'Surgical quarantine', costPerUnit: UNIT_COST_USD, verb: 'quarantine' },
  OTA_ROLLBACK: { label: 'OTA firmware rollback', costPerUnit: 0.4, verb: 'roll back firmware on' },
  CARRIER_INSPECTION: { label: 'In-transit inspection', costPerUnit: 3, verb: 'inspect' },
  ADVISORY: { label: 'Customer advisory', costPerUnit: 0, verb: 'notify owners of' },
};

export const REMEDY_FOR: Record<string, RemedyKind> = {
  cell_batch: 'QUARANTINE',
  cell_supplier: 'QUARANTINE',
  plant_id: 'QUARANTINE',
  bms_supplier: 'QUARANTINE',
  firmware: 'OTA_ROLLBACK',
  carrier: 'CARRIER_INSPECTION',
  climate_zone: 'ADVISORY',
};

export interface LotScope {
  lot_id: string;
  plant_id: string;
  build_start: string;
  build_end: string;
  unit_count: number;
  serial_start: number;
  serial_end: number;
}

export interface CauseFinding {
  hypothesisId: string;
  title: string;
  column: string;
  group: string;
  remedy: RemedyKind;
  units: number;
  failures: number;
  ratePer10k: number;
  baseRatePer10k: number;
  rr: { rr: number; lo: number; hi: number };
  coverage: number;
  supplier?: string;
  lots: LotScope[];
  byWarehouse: { warehouse_id: string; region: string; units: number; failures: number }[];
  costUsd: number;
  concordance: { family: string; share: number; claims: number };
  /** 95% intervals: failure rate per 10k (Wilson) and share of all incidents explained. */
  rateCI: { lo: number; hi: number };
  coverageCI: { lo: number; hi: number };
  falsifiers: Falsifier[];
}

export interface ActionPlan {
  causes: CauseFinding[];
  affectedUnits: number;
  blanketUnits: number;
  surgicalCostUsd: number;
  blanketCostUsd: number;
  savingsUsd: number;
  projectedIncidents30d: number;
  /** 90% interval for the 30-day projection (exact Poisson on the observed hazard). */
  projectedRange: { lo: number; hi: number };
  incidentsSoFar: number;
}

export interface RobustnessRow {
  cause: string;
  factor: string;
  strata: { stratum: string; rr: number; exposedRate: number; baseRate: number; informative: boolean }[];
  pLabel: string;
  consistent: boolean;
}

export interface Reveal {
  scenarioId: string;
  label: string;
  blurb: string;
  truth: { column: string; group: string }[];
  found: { column: string; group: string }[];
  gateBlocked: boolean;
  correct: boolean;
  /** correct; wrong; or insufficient (gate blocked before enough evidence existed, which is safe). */
  outcome: 'correct' | 'wrong' | 'insufficient';
}

export type InvestigationEvent =
  | { type: 'scenario'; id: string; label: string; blurb: string | null }
  | { type: 'phase'; phase: string; label: string }
  | { type: 'log'; text: string; tone?: 'info' | 'good' | 'warn' | 'bad' | 'model' }
  | { type: 'feeds'; feeds: { feed: string; status: string; note: string; count: number }[] }
  | { type: 'convergence'; data: Convergence & { totalSignals: number } }
  | { type: 'plan'; source: 'nemotron' | 'catalog'; via?: string; by?: string; reasoning: string; untestable: string[]; hypotheses: HypothesisNode[] }
  | { type: 'hypothesis'; node: HypothesisNode }
  | { type: 'evidence'; item: EvidenceItem }
  | { type: 'robustness'; data: RobustnessRow[] }
  | { type: 'granularity'; data: { cause: string; pLabel: string; p: number; groups: { group: string; ratePer10k: number }[]; implicated: boolean } }
  | { type: 'vision'; data: VisionFinding & { concordance: { claimsMentioningConnector: number; claimsInBatch: number } } }
  | { type: 'redteam'; source: 'nemotron' | 'built-in'; via?: string; objections: { objection: string; check: string; result: string; survived: boolean }[]; reasoning: string }
  | { type: 'timeline'; data: { cause: string; days: { date: string; claims: number; negLog10P: number }[]; threshold: number; alertDate: string | null; firstClaimDate: string; claimsAtAlert: number; claimsAfterAlert: number } }
  | { type: 'gate'; pass: boolean; criteria: GateCriterion[]; blanket?: { units: number; costUsd: number } }
  | { type: 'narrative'; source: 'nemotron' | 'template'; via?: string; fallbackFrom?: string; text: string; reasoning: string; cached?: boolean; guard: { checked: number; verified: number; unverified: string[] } }
  | { type: 'action'; plan: ActionPlan }
  | { type: 'markovian'; data: Awaited<ReturnType<typeof runBoundedChain>> }
  | { type: 'ledger'; root: string; count: number }
  | { type: 'reveal'; data: Reveal }
  | { type: 'forest'; rows: ForestRow[] }
  | { type: 'done'; ms: number; evidence: EvidenceItem[] }
  | { type: 'error'; message: string };

type Emit = (e: InvestigationEvent) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Proof chain ----------
export function chainGenesis(scenarioId: string) {
  return crypto.createHash('sha256').update(`traceon:${SKU}:${AS_OF}${scenarioId === 'reference' ? '' : `:${scenarioId}`}`).digest('hex');
}

/** One link of the chain: the previous head, the item's content hash, its label and the summary shown to people. */
export function chainStep(head: string, proofHash: string, label: string, summary: string) {
  return crypto.createHash('sha256').update(head).update(proofHash).update(label).update('\u0000').update(summary).digest('hex');
}

class ProofChain {
  items: EvidenceItem[] = [];
  private head: string;
  constructor(scenarioId: string) {
    this.head = chainGenesis(scenarioId);
  }
  add(item: Omit<EvidenceItem, 'id' | 'proofHash' | 'chainHash'> & { proofHash?: string }): EvidenceItem {
    const proofHash = item.proofHash ?? crypto.createHash('sha256').update(JSON.stringify(item.payload ?? item.summary)).digest('hex');
    this.head = chainStep(this.head, proofHash, item.label, item.summary);
    const full: EvidenceItem = { ...item, id: `E-${String(this.items.length + 1).padStart(2, '0')}`, proofHash, chainHash: this.head };
    this.items.push(full);
    return full;
  }
  get root() {
    return this.head;
  }
}

const groupSql = (column: string, where = '') =>
  `SELECT ${column} AS grp, COUNT(*) AS units, SUM(failed) AS failures\nFROM unit_fact${where ? `\nWHERE ${where}` : ''}\nGROUP BY ${column}`;

const toGroups = (rows: Record<string, unknown>[]) => rows.map((r) => ({ group: String(r.grp), units: Number(r.units), failures: Number(r.failures) }));

function hottest(test: IndependenceTest) {
  return [...test.groups].sort((a, b) => b.ratePer10k - a.ratePer10k || a.group.localeCompare(b.group))[0];
}

const fmtRate = (r: number) => `${r.toFixed(r < 10 ? 1 : 0)}/10k`;
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const sqlStr = (v: string) => {
  // alasql reads \' as an escaped quote, so a backslash could end the literal early.
  // Uploads reject such values; this guard keeps any other path from building one.
  if (/[\\\u0000-\u001f]/.test(v)) throw new Error(`Value ${JSON.stringify(v.slice(0, 40))} contains a backslash or control character`);
  return `'${v.replace(/'/g, "''")}'`;
};
const cond = (column: string, group: string) => `${column} = ${sqlStr(group)}`;

// Symptom families, used to check that a cause's claims share one failure signature.
const FAMILIES: { family: string; re: RegExp }[] = [
  { family: 'connector', re: /connector|pin/i },
  { family: 'charging', re: /charg|BMS error/i },
  { family: 'transit', re: /dent|deliver|crush|rattl/i },
  { family: 'assembly', re: /cuts out|hot spot|interconnect/i },
  { family: 'bms', re: /shuts off|percentage|does not stop/i },
];
const familyOf = (symptom: string) => FAMILIES.find((f) => f.re.test(symptom))?.family ?? 'general';

// Uploaded data has its own vocabulary: the signature is the word that most of
// a cause's claims share (and that is not just filler).
const SIG_STOP = new Set('with that this from after when then were very have does gets near unit item part product failed failure'.split(' '));
const sigWords = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !SIG_STOP.has(w)));
function dataSignature(symptoms: string[]): [string, number] {
  const df = new Map<string, number>();
  for (const s of symptoms) for (const w of sigWords(s)) df.set(w, (df.get(w) ?? 0) + 1);
  return [...df.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ['general', 0];
}

interface Screened {
  node: HypothesisNode;
  dim: Dimension;
  test: IndependenceTest;
  hot: string;
}

// ---------- Main entry ----------
export async function runInvestigation(emit: Emit, opts: { vision?: VisionFinding | null; scenarioId?: string; pacingMs?: number }) {
  const t0 = Date.now();
  const scenarioId = opts.scenarioId ?? 'reference';
  const pacing = opts.pacingMs ?? Number(process.env.DEMO_PACING_MS ?? 350);
  const mesh = getEnterpriseMesh(scenarioId);
  const unitCost = mesh.unitCost ?? UNIT_COST_USD;
  if (mesh.units.length === 0) throw new Error(`No units were in the field${mesh.scenario.asOf ? ` as of ${mesh.scenario.asOf}` : ''}; there is nothing to investigate`);
  const dims: Dimension[] = mesh.dimensions ?? DIMENSIONS;
  const cap = mesh.capabilities;
  const chain = new ProofChain(scenarioId);
  const record = (item: Parameters<ProofChain['add']>[0]) => {
    const e = chain.add(item);
    emit({ type: 'evidence', item: e });
    return e;
  };
  const log = (text: string, tone: 'info' | 'good' | 'warn' | 'bad' | 'model' = 'info') => emit({ type: 'log', text, tone });
  const q = (sql: string, silos: string[]) => runFederatedQuery(sql, silos, scenarioId);
  emit({ type: 'scenario', id: scenarioId, label: mesh.scenario.label, blurb: mesh.scenario.hidden ? null : mesh.scenario.blurb });

  // ---- 1. Ingest ----
  emit({ type: 'phase', phase: 'ingest', label: 'Ingesting signals across silos' });
  const feeds: FeedResult[] = await fetchAllFeeds(scenarioId);
  emit({ type: 'feeds', feeds: feeds.map((f) => ({ feed: f.feed, status: f.status, note: f.note, count: f.items.length })) });
  for (const f of feeds) record({ kind: 'feed', label: `Feed: ${f.feed}`, summary: `${f.status}: ${f.note}`, payload: f.items.map((i) => i.id) });

  const productSignals: IncomingSignal[] = feeds
    .flatMap((f) => f.items)
    .filter((i) => i.kind !== 'federal')
    .map((i) => ({ id: i.id, channel: i.kind === 'warranty' ? 'warranty' : i.source, date: i.date, city: i.city, text: `${i.title}. ${i.detail}`, tags: i.tags }));
  const ing = ingestSignals(productSignals, scenarioId);
  log(`H-MEM: ${ing.added} new signals stored (${ing.total} memories total, durable across sessions)`);
  await sleep(pacing);

  // ---- 2. Converge ----
  emit({ type: 'phase', phase: 'converge', label: 'H-MEM converging weak signals' });
  const signature = 'VR-48 pack hot overheat connector pin scorch burning smoke swelling charging';
  const conv = convergeSignals(signature, scenarioId);
  emit({ type: 'convergence', data: { ...conv, totalSignals: productSignals.length } });
  record({
    kind: 'memory',
    label: 'H-MEM convergence',
    summary: mesh.custom
      ? `${conv.matched.length} uploaded failure records converged (${conv.firstSeen} to ${conv.lastSeen})`
      : `${conv.matched.length} signals across ${Object.keys(conv.channels).length} channels and ${Object.keys(conv.cities).length} cities share the thermal signature (${conv.firstSeen} to ${conv.lastSeen})`,
    payload: { signature, matched: conv.matched.map((m) => m.source) },
  });
  if (conv.priorInsights.length) log(`H-MEM recalled ${conv.priorInsights.length} approved root-cause insight(s) from a previous session`, 'good');
  await sleep(pacing);

  // ---- 3. Plan ----
  emit({ type: 'phase', phase: 'plan', label: `${aiPrimaryName()} planning hypotheses` });
  const plan = await planHypotheses(conv, opts.vision ?? null, scenarioId, log, dims);
  emit({ type: 'plan', ...plan });
  if (plan.source === 'nemotron') log(`${plan.by} ranked ${plan.hypotheses.length} hypotheses (${plan.via})`, 'model');
  record({ kind: 'model', label: 'Hypothesis plan', summary: plan.hypotheses.map((h) => h.id).join(' > '), payload: plan });
  const nodes = new Map(plan.hypotheses.map((h) => [h.id, h]));
  const update = (node: HypothesisNode) => emit({ type: 'hypothesis', node: { ...node } });

  const k = dims.length;
  const alpha = 0.01 / k; // Bonferroni across hypotheses
  const screened: Screened[] = [];
  let confirmed: Screened[] = [];
  const robustnessOut: RobustnessRow[] = [];
  const findings = new Map<string, CauseFinding>();
  const granularity = new Map<string, { pLabel: string; implicated: boolean }>();
  const exposure = new Map<string, { exposedDays: number; otherDays: number }>();
  const geoCmh = new Map<string, CmhResult>();
  const geoBy = new Map<string, string>(); // what the geography check stratified by
  let redteam: Extract<InvestigationEvent, { type: 'redteam' }> | null = null;
  let connectorConcordance = { claimsMentioningConnector: 0, claimsInBatch: 0 };
  const cleanTest = new Map<Screened, IndependenceTest>();
  let residual: { dim: Dimension; test: IndependenceTest; hot: string; pLabel: string }[] = [];
  let residualMinP = 1;

  // Each Markovian step sees only the compact carryover, never the full transcript.
  const carry = () =>
    JSON.stringify({
      ruledOut: [...nodes.values()].filter((n) => n.status === 'NO_ASSOCIATION' || n.status === 'CONFOUNDED').map((n) => n.id),
      leads: screened.map((s) => `${s.node.id}:${s.hot}`),
      confirmed: confirmed.map((c) => `${c.dim.column}=${c.hot}`),
    });

  const steps = [
    // ---- 4. Screen every hypothesis ----
    ...plan.hypotheses.map((h) => ({
      run: async () => {
        emit({ type: 'phase', phase: 'screen', label: `Testing ${h.id}: ${h.title}` });
        const dim = dims.find((d) => d.id === h.id)!;
        const node = nodes.get(h.id)!;
        node.status = 'TESTING';
        update(node);
        await sleep(pacing);
        const res = await q(groupSql(dim.column), ['unit_fact', dim.silo]);
        const test = chiSquareIndependence(toGroups(res.rows));
        const hot = hottest(test);
        const pLabel = formatP(test.p, test.negLog10P);
        node.rawTest = { ...test, pLabel };
        node.hotGroup = hot.group;
        {
          const rest = test.groups.filter((g) => g.group !== hot.group);
          node.rawRR = relativeRisk(hot.failures, hot.units, rest.reduce((a, g) => a + g.failures, 0), rest.reduce((a, g) => a + g.units, 0));
        }
        const ev = record({ kind: 'sql', label: `${h.id} screen`, summary: `${dim.column}: chi2=${test.chi2.toFixed(1)}, df=${test.df}, ${pLabel}`, query: res, proofHash: res.proofHash });
        node.evidenceIds.push(ev.id);
        if (test.p >= alpha) {
          node.status = 'NO_ASSOCIATION';
          const lo = [...test.groups].sort((a, b) => a.ratePer10k - b.ratePer10k)[0];
          node.verdict = `Ruled out. Failure rate is flat across ${dim.column} (${fmtRate(lo.ratePer10k)} to ${fmtRate(hot.ratePer10k)}, ${pLabel}).`;
          log(`${h.id} ruled out: no association (${pLabel})`, 'good');
        } else {
          node.status = 'SIGNIFICANT';
          node.verdict = `Associated on raw data: ${hot.group} fails at ${fmtRate(hot.ratePer10k)} (${pLabel}). Needs adjustment for confounders.`;
          screened.push({ node, dim, test, hot: hot.group });
          log(`${h.id} looks guilty on raw data (${pLabel}); queued for confounder adjustment`, 'warn');
        }
        update(node);
        return { text: node.verdict, carryover: carry() };
      },
    })),

    // ---- 5. Adjudicate confounders (CMH), allowing several independent causes ----
    {
      run: async () => {
        emit({ type: 'phase', phase: 'adjudicate', label: 'Separating causes from confounders' });
        const fails = new Map<Screened, Screened>(); // suspect -> the factor that explains it away
        const aliases = new Map<Screened, Screened[]>();
        for (const s of screened) {
          s.node.adjusted = [];
          for (const other of screened) {
            if (other === s) continue;
            const res = await q(
              `SELECT ${s.dim.column} AS exposure, ${other.dim.column} AS stratum, COUNT(*) AS units, SUM(failed) AS failures\nFROM unit_fact\nGROUP BY ${s.dim.column}, ${other.dim.column}`,
              ['unit_fact']
            );
            const strata = collapseStrata(res.rows, s.hot, other.hot, other.dim.column);
            const aliased = strata.length === 0; // perfectly collinear: no stratum has both exposed and unexposed units
            const cmh = cochranMantelHaenszel(strata);
            const pLabel = aliased ? 'aliased (same units)' : formatP(cmh.p, cmh.negLog10P);
            s.node.adjusted.push({ controlFor: other.node.id, controlLabel: cond(other.dim.column, other.hot), pLabel, p: aliased ? NaN : cmh.p, commonOddsRatio: cmh.commonOddsRatio, aliased });
            const ev = record({ kind: 'stat', label: `${s.node.id} | ${other.node.id}`, summary: `CMH ${cond(s.dim.column, s.hot)} controlling for ${cond(other.dim.column, other.hot)}: ${pLabel}`, query: res, proofHash: res.proofHash, payload: cmh });
            s.node.evidenceIds.push(ev.id);
            if (aliased) aliases.set(s, [...(aliases.get(s) ?? []), other]);
            // The hot group was picked post hoc from G groups, so its adjusted test pays for that selection.
            else if (cmh.p >= alpha / Math.max(1, s.test.groups.length - 1) && !fails.has(s)) fails.set(s, other);
          }
        }
        let survivors = screened.filter((s) => !fails.has(s));
        // Aliased survivors describe the same units; keep the most specific (fewest units).
        const unitsOf = (s: Screened) => s.test.groups.find((g) => g.group === s.hot)?.units ?? Infinity;
        const redundant = new Map<Screened, Screened>();
        for (const s of survivors) {
          for (const a of aliases.get(s) ?? []) {
            if (survivors.includes(a) && (unitsOf(a) < unitsOf(s) || (unitsOf(a) === unitsOf(s) && a.node.id < s.node.id))) redundant.set(s, a);
          }
        }
        survivors = survivors.filter((s) => !redundant.has(s));
        // Each survivor's strength is measured with the other survivors' units
        // excluded, so two real causes don't inflate each other's baseline.
        for (const s of survivors) {
          const others = survivors.filter((o) => o !== s).map((o) => cond(o.dim.column, o.hot));
          if (!others.length) {
            cleanTest.set(s, s.test);
            continue;
          }
          const res = await q(groupSql(s.dim.column, `NOT (${others.join(' OR ')})`), ['unit_fact', s.dim.silo]);
          cleanTest.set(s, chiSquareIndependence(toGroups(res.rows)));
          const ev = record({ kind: 'sql', label: `${s.node.id} excluding other causes`, summary: `${s.dim.column} with ${others.join(', ')} excluded`, query: res, proofHash: res.proofHash });
          s.node.evidenceIds.push(ev.id);
        }
        const strength = (s: Screened) => {
          const t = cleanTest.get(s)!;
          const hot = t.groups.find((g) => g.group === s.hot) ?? hottest(t);
          const rest = t.groups.filter((g) => g.group !== hot.group);
          const restUnits = rest.reduce((a, g) => a + g.units, 0);
          const restFail = rest.reduce((a, g) => a + g.failures, 0);
          return { hot, restUnits, restFail, rr: relativeRisk(hot.failures, hot.units, restFail, restUnits) };
        };
        // A cause must also be material: at least double the baseline rate.
        confirmed = survivors.filter((s) => strength(s).rr.rr >= 2);

        for (const s of screened) {
          if (confirmed.includes(s)) continue;
          s.node.status = 'CONFOUNDED';
          const by = fails.get(s) ?? redundant.get(s);
          const adj = by && s.node.adjusted?.find((a) => a.controlFor === by.node.id);
          s.node.verdict = redundant.has(s)
            ? `Ruled out as redundant. ${s.hot} covers exactly the same units as ${by!.hot}, which is the more specific explanation.`
            : by && adj
              ? `Ruled out as a confounder. ${s.hot} only looks guilty because it shares units with ${by.hot}; holding ${by.dim.column} fixed, the effect disappears (${adj.pLabel}).`
              : 'Ruled out: effect too small to act on after adjustment.';
          update(s.node);
          log(`${s.node.id} unmasked as ${redundant.has(s) ? 'redundant' : 'confounder'}`, 'good');
          await sleep(pacing);
        }
        for (const c of confirmed) {
          c.node.status = 'CONFIRMED';
          const { hot: cleanHot, restUnits, restFail, rr } = strength(c);
          const hot = { ...cleanHot, ...(c.test.groups.find((g) => g.group === c.hot) ?? cleanHot) };
          const totalFail = c.test.groups.reduce((a, g) => a + g.failures, 0);
          const coverage = hot.failures / Math.max(1, totalFail);
          c.node.verdict = `Confirmed. ${hot.group} fails at ${fmtRate(hot.ratePer10k)} vs ${fmtRate((restFail / restUnits) * 1e4)} elsewhere (RR ${rr.rr.toFixed(0)}x, 95% CI ${rr.lo.toFixed(0)}-${rr.hi.toFixed(0)}). It holds up after adjusting for every other factor and accounts for ${(coverage * 100).toFixed(0)}% of incidents.`;
          findings.set(c.node.id, {
            hypothesisId: c.node.id,
            title: c.dim.title,
            column: c.dim.column,
            group: c.hot,
            remedy: REMEDY_FOR[c.dim.column] ?? (mesh.custom ? 'QUARANTINE' : 'ADVISORY'),
            units: hot.units,
            failures: hot.failures,
            ratePer10k: hot.ratePer10k,
            baseRatePer10k: (restFail / restUnits) * 1e4,
            rr,
            coverage,
            lots: [],
            byWarehouse: [],
            costUsd: 0,
            concordance: { family: 'general', share: 0, claims: 0 },
            rateCI: (({ lo, hi }) => ({ lo: lo * 1e4, hi: hi * 1e4 }))(wilson(hot.failures, hot.units)),
            coverageCI: (({ lo, hi }) => ({ lo, hi }))(wilson(hot.failures, Math.max(1, totalFail))),
            falsifiers: [],
          });
          update(c.node);
          log(`${c.node.id} survives all adjustments: ${c.hot}`, 'good');
        }
        if (!confirmed.length) log(screened.length ? 'No suspect survives adjustment' : 'No suspect beats the multiple-testing bar', 'warn');
        const top = plan.hypotheses[0];
        if (plan.source === 'nemotron' && top && !confirmed.some((c) => c.node.id === top.id)) {
          log(`${plan.by ?? 'The model'}'s top suspect was ${top.id} (${top.title}); the evidence overruled it: ${nodes.get(top.id)?.status === 'CONFOUNDED' ? 'a confounder' : 'no association'}`, 'model');
        }
        return { text: `${confirmed.length} cause(s) confirmed`, carryover: carry() };
      },
    },

    // ---- 6. Robustness across strata ----
    {
      run: async () => {
        if (!confirmed.length) return { text: 'skipped', carryover: carry() };
        emit({ type: 'phase', phase: 'robustness', label: 'Checking each cause in every subgroup' });
        for (const c of confirmed) {
          // Generated data: five operational factors. Uploaded data: every other factor (up to 5).
          const factors = (mesh.custom ? dims.map((d) => d.column) : ['firmware', 'carrier', 'climate_zone', 'bms_supplier', 'warehouse_id'])
            .filter((f) => f !== c.dim.column)
            .slice(0, 5);
          const f0 = findings.get(c.node.id)!;
          const exposedRate = f0.failures / f0.units;
          const others = confirmed.filter((o) => o !== c).map((o) => cond(o.dim.column, o.hot));
          const where = others.length ? `\nWHERE NOT (${others.join(' OR ')})` : '';
          for (const f of factors) {
            const res = await q(
              `SELECT ${c.dim.column} AS exposure, ${f} AS stratum, COUNT(*) AS units, SUM(failed) AS failures\nFROM unit_fact${where}\nGROUP BY ${c.dim.column}, ${f}`,
              ['unit_fact']
            );
            const strata = collapseStrata(res.rows, c.hot, null, f);
            const cmh = cochranMantelHaenszel(strata);
            const rows = strata.map((s) => ({
              stratum: s.stratum,
              rr: relativeRisk(s.exposedFailures, s.exposedUnits, s.unexposedFailures, s.unexposedUnits).rr,
              exposedRate: (s.exposedFailures / Math.max(1, s.exposedUnits)) * 1e4,
              baseRate: (s.unexposedFailures / Math.max(1, s.unexposedUnits)) * 1e4,
              // Too few expected failures to say anything about this subgroup.
              informative: s.exposedUnits * exposedRate >= 3,
            }));
            const consistent = cmh.p < alpha && rows.every((r) => !r.informative || r.rr > 2);
            const pLabel = formatP(cmh.p, cmh.negLog10P);
            robustnessOut.push({ cause: c.hot, factor: f, strata: rows, pLabel, consistent });
            if (f === 'warehouse_id' || (mesh.custom && !geoCmh.has(c.node.id))) {
              geoCmh.set(c.node.id, cmh);
              geoBy.set(c.node.id, f === 'warehouse_id' ? 'warehouse' : (dims.find((d) => d.column === f)?.title ?? f));
            }
            const ev = record({ kind: 'stat', label: `Robustness ${c.hot} by ${f}`, summary: `${c.hot} effect within ${rows.length} ${f} strata: ${consistent ? 'consistent' : 'INCONSISTENT'} (${pLabel})`, query: res, proofHash: res.proofHash });
            c.node.evidenceIds.push(ev.id);
          }
          update(c.node);
        }
        emit({ type: 'robustness', data: robustnessOut });
        log(`Effects hold in ${robustnessOut.filter((r) => r.consistent).length}/${robustnessOut.length} stratifications`, robustnessOut.every((r) => r.consistent) ? 'good' : 'warn');
        return { text: 'robustness done', carryover: carry() };
      },
    },

    // ---- 7. Scope, granularity, symptom concordance, exposure time ----
    {
      run: async () => {
        if (!confirmed.length) return { text: 'skipped', carryover: carry() };
        emit({ type: 'phase', phase: 'scope', label: 'Mapping causes to lots and serials' });
        for (const c of confirmed) {
          const f = findings.get(c.node.id)!;
          // Physical causes map to production lots through the BOM/ERP join.
          const lotTable = c.dim.column === 'plant_id' ? 'l' : 'b';
          if (cap.lineage && ['cell_batch', 'cell_supplier', 'bms_supplier', 'plant_id'].includes(c.dim.column)) {
            const lineage = await q(
              `SELECT b.cell_batch, b.cell_supplier, l.lot_id, l.plant_id, l.line_id, l.build_start, l.build_end, l.unit_count, l.serial_start, l.serial_end\nFROM supplier_bom_lineage b\nJOIN erp_production_lots l ON b.lot_id = l.lot_id\nWHERE ${lotTable}.${c.dim.column} = ${sqlStr(c.hot)}`,
              ['supplier_bom_lineage', 'erp_production_lots']
            );
            f.lots = lineage.rows
              .map((r) => ({ lot_id: String(r.lot_id), plant_id: String(r.plant_id), build_start: String(r.build_start), build_end: String(r.build_end), unit_count: Number(r.unit_count), serial_start: Number(r.serial_start), serial_end: Number(r.serial_end) }))
              .sort((a, b) => a.lot_id.localeCompare(b.lot_id));
            f.supplier = c.dim.column === 'cell_batch' ? String(lineage.rows[0]?.cell_supplier ?? '') : undefined;
            const shown = f.lots.slice(0, 3).map((l) => `${l.lot_id} (${l.plant_id}, ${l.build_start}..${l.build_end}, SN-${l.serial_start}..SN-${l.serial_end})`);
            record({ kind: 'sql', label: `BOM lineage join ${c.hot}`, summary: `${c.hot} -> ${f.lots.length} lot(s): ${shown.join(', ')}${f.lots.length > 3 ? ', …' : ''}`, query: lineage, proofHash: lineage.proofHash });
          }

          if (cap.lineage && c.dim.column === 'cell_batch' && f.supplier) {
            const g = await q(groupSql('cell_supplier', `cell_batch <> ${sqlStr(c.hot)}`), ['unit_fact', SILO_CATALOG.supplier_bom_lineage]);
            const test = chiSquareIndependence(toGroups(g.rows));
            const data = { cause: c.hot, pLabel: formatP(test.p, test.negLog10P), p: test.p, groups: test.groups.map((x) => ({ group: x.group, ratePer10k: x.ratePer10k })), implicated: test.p < alpha };
            granularity.set(c.node.id, data);
            emit({ type: 'granularity', data });
            record({ kind: 'sql', label: `Supplier granularity ${c.hot}`, summary: `Excluding ${c.hot}, cell suppliers ${data.implicated ? 'DO' : 'do not'} differ (${data.pLabel})`, query: g, proofHash: g.proofHash });
          }

          if (cap.symptoms) {
          const conc = await q(`SELECT c.claim_id, c.symptom, c.severity\nFROM warranty_claims c\nJOIN unit_fact u ON c.serial = u.serial\nWHERE u.${cond(c.dim.column, c.hot)}`, ['warranty_claims', 'unit_fact']);
          const counts = new Map<string, number>();
          for (const r of conc.rows) counts.set(familyOf(String(r.symptom)), (counts.get(familyOf(String(r.symptom))) ?? 0) + 1);
          const top = mesh.custom
            ? dataSignature(conc.rows.map((r) => String(r.symptom)))
            : [...counts.entries()].filter(([fam]) => fam !== 'general').sort((a, b) => b[1] - a[1])[0] ?? ['general', 0];
          f.concordance = { family: top[0], share: conc.rowCount ? top[1] / conc.rowCount : 0, claims: conc.rowCount };
          if (top[0] === 'connector') connectorConcordance = { claimsMentioningConnector: top[1], claimsInBatch: conc.rowCount };
          record({ kind: 'sql', label: `Symptom concordance ${c.hot}`, summary: `${top[1]}/${conc.rowCount} claims for ${c.hot} share the "${top[0]}" failure signature`, query: conc, proofHash: conc.proofHash });
          } else {
            f.concordance = { family: 'n/a', share: 0, claims: 0 };
          }

          if (cap.daysInField) {
          const ex = await q(
            `SELECT ${c.dim.column} = ${sqlStr(c.hot)} AS exposed, AVG(days_in_field) AS avg_days\nFROM unit_fact\nGROUP BY ${c.dim.column} = ${sqlStr(c.hot)}`,
            ['unit_fact']
          );
          const e = { exposedDays: 0, otherDays: 0 };
          for (const r of ex.rows) {
            if (r.exposed === true || r.exposed === 1) e.exposedDays = Number(r.avg_days);
            else e.otherDays = Number(r.avg_days);
          }
          exposure.set(c.node.id, e);
          record({ kind: 'sql', label: `Exposure-time ${c.hot}`, summary: `${c.hot} units: ${e.exposedDays.toFixed(1)} days in field on average vs ${e.otherDays.toFixed(1)} for other units`, query: ex, proofHash: ex.proofHash });
          }

          if (cap.warehouses) {
          const byWh = await q(
            `SELECT warehouse_id, region, COUNT(*) AS units, SUM(failed) AS failures\nFROM unit_fact\nWHERE ${cond(c.dim.column, c.hot)}\nGROUP BY warehouse_id, region`,
            ['unit_fact', SILO_CATALOG.warehouses]
          );
          f.byWarehouse = byWh.rows
            .map((r) => ({ warehouse_id: String(r.warehouse_id), region: String(r.region), units: Number(r.units), failures: Number(r.failures) }))
            .sort((a, b) => b.units - a.units || a.warehouse_id.localeCompare(b.warehouse_id));
          record({ kind: 'sql', label: `Blast radius ${c.hot}`, summary: `${f.units} units across ${byWh.rowCount} warehouses -> ${REMEDY[f.remedy].label}`, query: byWh, proofHash: byWh.proofHash });
          }
          f.costUsd = Math.round(f.units * (f.remedy === 'QUARANTINE' ? unitCost : REMEDY[f.remedy].costPerUnit));
        }
        return { text: 'scope mapped', carryover: carry() };
      },
    },

    // ---- 7b. Residual screen: with the confirmed causes removed, is anything left? ----
    {
      run: async () => {
        if (!confirmed.length) return { text: 'skipped', carryover: carry() };
        emit({ type: 'phase', phase: 'scope', label: 'Checking what the causes leave unexplained' });
        const removed = confirmed.map((c) => cond(c.dim.column, c.hot)).join(' OR ');
        residual = [];
        for (const d of dims) {
          const res = await q(groupSql(d.column, `NOT (${removed})`), ['unit_fact', d.silo]);
          const test = chiSquareIndependence(toGroups(res.rows));
          const pLabel = formatP(test.p, test.negLog10P);
          record({ kind: 'sql', label: `Residual ${d.id}`, summary: `${d.column} with confirmed causes removed: ${pLabel}`, query: res, proofHash: res.proofHash });
          residualMinP = Math.min(residualMinP, test.p);
          if (test.p < alpha) residual.push({ dim: d, test, hot: hottest(test).group, pLabel });
        }
        log(residual.length ? `Unexplained structure remains: ${residual.map((r) => `${r.dim.column}=${r.hot} (${r.pLabel})`).join(', ')}` : 'Remaining incidents look like baseline noise', residual.length ? 'warn' : 'good');
        return { text: 'residual', carryover: carry() };
      },
    },

    // ---- 8. Vision corroboration ----
    {
      run: async () => {
        emit({ type: 'phase', phase: 'vision', label: 'Corroborating with defect photo' });
        const v = opts.vision;
        if (v) {
          emit({ type: 'vision', data: { ...v, concordance: connectorConcordance } });
          record({ kind: 'vision', label: 'Defect photo forensics', summary: `${v.live ? v.model : 'offline reference analysis'}: ${v.physicalFailureMode} at ${v.suspectedComponent} (severity ${v.severityScore})`, payload: v });
        } else {
          log('No defect photo supplied; visual corroboration skipped', 'warn');
        }
        return { text: 'vision', carryover: carry() };
      },
    },

    // ---- 9. Red team ----
    {
      run: async () => {
        if (!confirmed.length) return { text: 'skipped', carryover: carry() };
        emit({ type: 'phase', phase: 'redteam', label: `${aiPrimaryName()} red-teaming the verdict` });
        redteam = await redTeam(confirmed, { alpha, granularity, exposure, geoCmh, geoBy, robustnessOut, screenedCount: k, batches: mesh.bom.length }, log);
        emit(redteam);
        record({ kind: 'model', label: 'Red-team review', summary: `${redteam.objections.filter((o) => o.survived).length}/${redteam.objections.length} objections answered by evidence`, payload: redteam });
        return { text: 'redteam', carryover: carry() };
      },
    },
  ];

  const chainStats = await runBoundedChain(`Find the root cause of ${SKU} thermal incidents`, steps);
  emit({ type: 'markovian', data: chainStats });

  const reveal = (gateBlocked: boolean): Reveal => {
    // On a cutoff date, a planted cause whose units had not shipped yet is not discoverable.
    const truth = scenarioTruth(mesh.scenario).filter(
      (t) => !mesh.scenario.asOf || mesh.units.some((u) => String((u as unknown as Record<string, unknown>)[t.column]) === t.group)
    );
    const found = confirmed.map((c) => ({ column: c.dim.column, group: c.hot }));
    const key = (x: { column: string; group: string }) => `${x.column}=${x.group}`;
    const same = truth.length === found.length && truth.every((t) => found.some((f) => key(f) === key(t)));
    const correct = same && gateBlocked === (truth.length === 0);
    // Blocking with nothing found while a cause exists is "not enough evidence yet": safe, not wrong.
    const noFalseFinding = found.every((f) => truth.some((t) => key(t) === key(f)));
    const outcome = correct ? 'correct' : gateBlocked && noFalseFinding && truth.length > 0 ? 'insufficient' : 'wrong';
    return { scenarioId, label: mesh.scenario.label, blurb: mesh.scenario.blurb, truth, found, gateBlocked, correct, outcome };
  };
  const finish = (gateBlocked: boolean) => {
    emit({ type: 'ledger', root: chain.root, count: chain.items.length });
    const rv = mesh.scenario.truthKnown ? reveal(gateBlocked) : null;
    if (rv) emit({ type: 'reveal', data: rv });
    const top = plan.hypotheses[0];
    if (plan.source === 'nemotron' && top) {
      const truthKeys = new Set((rv?.truth ?? []).map((t) => t.column));
      recordScore({
        at: new Date().toISOString(),
        scenarioId,
        modelTop: top.id,
        modelTopTitle: top.title,
        ledgerRoot: chain.root,
        statsConfirmed: confirmed.map((c) => c.node.id),
        agreed: confirmed.some((c) => c.node.id === top.id),
        truthKnown: Boolean(rv),
        modelTopCorrect: rv ? truthKeys.has(dims.find((d) => d.id === top.id)?.column as never) : null,
        statsCorrect: rv ? rv.correct : null,
      });
    }
    emit({ type: 'done', ms: Date.now() - t0, evidence: chain.items });
  };
  // Forest plot: every suspect's raw relative risk with its interval.
  const emitForest = () =>
    emit({
      type: 'forest',
      rows: [...nodes.values()]
        .filter((n) => n.rawRR && n.hotGroup)
        .map((n) => {
          const worst = [...(n.adjusted ?? [])].filter((a) => !a.aliased).sort((a, b) => b.p - a.p)[0];
          return { id: n.id, title: n.title, status: n.status, group: n.hotGroup!, rr: n.rawRR!.rr, lo: n.rawRR!.lo, hi: n.rawRR!.hi, adjustedP: n.status === 'CONFOUNDED' ? worst?.pLabel : undefined };
        }),
    });

  if (!confirmed.length) {
    const best = [...nodes.values()].filter((n) => n.rawTest).sort((a, b) => a.rawTest!.p - b.rawTest!.p)[0];
    emit({
      type: 'gate',
      pass: false,
      blanket: { units: mesh.units.length, costUsd: mesh.units.length * unitCost },
      criteria: [
        {
          id: 'cause',
          label: 'At least one factor survives testing',
          pass: false,
          detail: screened.length
            ? `${screened.length} suspect(s) looked associated on raw data, but none survived adjustment for the others.`
            : `No suspect beat the multiple-testing bar (best: ${best?.id} ${best?.rawTest?.pLabel}, alpha ${alpha.toExponential(1)}).`,
        },
        { id: 'noise', label: 'Complaints are consistent with baseline noise', pass: true, detail: `${mesh.claims.length} claims across ${mesh.units.length.toLocaleString('en-US')} units; ${screened.length ? 'every association found was explained by another factor' : 'no structure in any factor'}` },
      ],
    });
    emit({ type: 'phase', phase: 'explain', label: 'Writing the explanation' });
    const facts = {
      product: mesh.custom ? mesh.scenario.label : PRODUCT_NAME,
      custom: Boolean(mesh.custom),
      claims: mesh.claims.length,
      units: mesh.units.length,
      suspectsTested: k,
      bestSuspect: best ? `${best.title} (${best.rawTest?.pLabel})` : 'none',
      ruledOut: [...nodes.values()].map((n) => ({ title: n.title, verdict: n.verdict })),
      blanketRecallCostAvoidedUsd: mesh.units.length * unitCost,
      recommendation: 'No recall. Keep monitoring; re-run when new claims arrive.',
    };
    const narrative = await explain(facts, noCauseTemplate(facts), log);
    emit({ type: 'narrative', ...narrative });
    record({ kind: 'model', label: 'Explanation', summary: `${narrative.guard.verified}/${narrative.guard.checked} figures verified against evidence`, payload: narrative.text });
    emitForest();
    finish(true);
    return;
  }

  const primary = [...confirmed].sort((a, b) => findings.get(b.node.id)!.coverage - findings.get(a.node.id)!.coverage)[0];
  const causeList = confirmed.map((c) => findings.get(c.node.id)!);

  // ---- 10. Early-warning replay (primary cause) ----
  const timeline = cap.dates
    ? { cause: primary.hot, ...earlyWarningReplay(scenarioId, primary.dim.column, primary.hot) }
    : { cause: primary.hot, days: [], threshold: 0, alertDate: null as string | null, firstClaimDate: '', claimsAtAlert: 0, claimsAfterAlert: 0 };
  if (cap.dates) {
    emit({ type: 'phase', phase: 'timeline', label: 'Replaying when this was detectable' });
    emit({ type: 'timeline', data: timeline });
    record({ kind: 'stat', label: 'Early-warning replay', summary: timeline.alertDate ? `${primary.hot} detectable on ${timeline.alertDate} after ${timeline.claimsAtAlert} claims; ${timeline.claimsAfterAlert} later claims were preventable` : 'Never crossed alert threshold', payload: timeline });
  }

  // ---- 11. Action plan ----
  const unionWhere = confirmed.map((c) => `(${cond(c.dim.column, c.hot)})`).join(' OR ');
  const union = await q(`SELECT COUNT(*) AS units, SUM(failed) AS failures\nFROM unit_fact\nWHERE ${unionWhere}`, ['unit_fact']);
  const totalFailures = mesh.units.reduce((a, u) => a + u.failed, 0);
  const explained = Number(union.rows[0]?.failures ?? 0);
  const coverage = explained / Math.max(1, totalFailures);
  record({ kind: 'sql', label: 'Combined coverage', summary: `Confirmed causes explain ${explained}/${totalFailures} incidents (${(coverage * 100).toFixed(1)}%)`, query: union, proofHash: union.proofHash });
  const quarantineWhere = confirmed.filter((c) => REMEDY_FOR[c.dim.column] === 'QUARANTINE').map((c) => `(${cond(c.dim.column, c.hot)})`);
  let quarantineUnits = 0;
  if (quarantineWhere.length) {
    const qu = await q(`SELECT COUNT(*) AS units\nFROM unit_fact\nWHERE ${quarantineWhere.join(' OR ')}`, ['unit_fact']);
    quarantineUnits = Number(qu.rows[0]?.units ?? 0);
  }
  const blanketUnits = mesh.units.length;
  const surgicalCostUsd =
    quarantineUnits * unitCost + causeList.filter((f) => f.remedy !== 'QUARANTINE').reduce((a, f) => a + f.costUsd, 0);
  // Constant-hazard projection with an exact Poisson range on the observed failure count.
  let projected = 0;
  let projLo = 0;
  let projHi = 0;
  for (const f of causeList) {
    const days = exposure.get(f.hypothesisId)?.exposedDays || 30;
    const atRisk = (f.units - f.failures) * 30 / Math.max(1, f.units * days);
    const pi = poissonInterval(f.failures, 0.9);
    projected += f.failures * atRisk;
    projLo += pi.lo * atRisk;
    projHi += pi.hi * atRisk;
  }
  const plan2: ActionPlan = {
    causes: causeList,
    affectedUnits: quarantineUnits + causeList.filter((f) => f.remedy !== 'QUARANTINE').reduce((a, f) => a + f.units, 0),
    blanketUnits,
    surgicalCostUsd,
    blanketCostUsd: blanketUnits * unitCost,
    savingsUsd: blanketUnits * unitCost - surgicalCostUsd,
    projectedIncidents30d: Math.round(projected),
    projectedRange: { lo: Math.round(projLo), hi: Math.round(projHi) },
    incidentsSoFar: explained,
  };

  // ---- 11b. What would falsify each cause? ----
  {
    const outside = await q(
      `SELECT COUNT(*) AS units, SUM(failed) AS failures${cap.daysInField ? ', AVG(days_in_field) AS days' : ''}\nFROM unit_fact\nWHERE NOT (${unionWhere})`,
      ['unit_fact']
    );
    const n0 = Number(outside.rows[0]?.units ?? 0);
    const f0 = Number(outside.rows[0]?.failures ?? 0);
    const d0 = cap.daysInField ? Number(outside.rows[0]?.days ?? 0) || 30 : 30;
    const per30 = (failures: number) => (n0 ? (failures / n0) * (30 / d0) * 1e4 : 0);
    const baseNow = per30(f0);
    const baseLimit = per30(poissonInterval(f0, 0.98).hi);
    record({ kind: 'sql', label: 'Falsification baseline', summary: `Outside the causes: ${f0} failures in ${n0.toLocaleString('en-US')} units`, query: outside, proofHash: outside.proofHash });
    let otherSignature: Map<string, number> | null = null;
    let otherSymptoms: string[] = [];
    let otherClaims = 0;
    if (cap.symptoms) {
      const oc = await q(`SELECT c.symptom\nFROM warranty_claims c\nJOIN unit_fact u ON c.serial = u.serial\nWHERE NOT (${unionWhere.replace(/\(([a-z_0-9]+) =/g, '(u.$1 =')})`, ['warranty_claims', 'unit_fact']);
      otherSignature = new Map();
      for (const r of oc.rows) otherSignature.set(familyOf(String(r.symptom)), (otherSignature.get(familyOf(String(r.symptom))) ?? 0) + 1);
      otherSymptoms = oc.rows.map((r) => String(r.symptom));
      otherClaims = oc.rowCount;
    }
    for (const f of causeList) {
      const rows = robustnessOut.filter((r) => r.cause === f.group).flatMap((r) => r.strata.filter((x) => x.informative));
      const minRR = rows.length ? Math.min(...rows.map((x) => x.rr)) : null;
      const fs: Falsifier[] = [
        { id: 'baseline', label: 'The rest of the population stays at baseline', rule: `If units outside the confirmed causes fail at more than ${baseLimit.toFixed(1)} per 10k over 30 days, something else is failing too.`, threshold: Number(baseLimit.toFixed(2)), current: Number(baseNow.toFixed(2)), unit: 'per 10k per 30 days' },
        { id: 'subgroups', label: 'The effect holds in every subgroup', rule: `If ${f.group}'s relative risk drops below 2 in any subgroup with at least 3 expected failures, the cause is not the explanation there.`, threshold: 2, current: minRR === null ? null : Number(Math.min(minRR, 9999).toFixed(1)), unit: 'lowest subgroup relative risk' },
        { id: 'residual', label: 'Nothing new appears', rule: `If any factor becomes significant (p below ${alpha.toExponential(1)}) once the causes are removed, a cause is missing.`, threshold: alpha, current: Number(residualMinP.toPrecision(2)), unit: 'smallest residual p-value' },
      ];
      if (otherSignature && f.concordance.family !== 'n/a' && f.concordance.family !== 'general') {
        const matching = mesh.custom ? otherSymptoms.filter((x) => sigWords(x).has(f.concordance.family)).length : otherSignature.get(f.concordance.family) ?? 0;
        const share = otherClaims ? matching / otherClaims : 0;
        fs.splice(1, 0, { id: 'signature', label: 'The failure signature stays with the cause', rule: `If more than 40% of failures outside ${f.group} show the "${f.concordance.family}" signature, the defect is not confined to it.`, threshold: 0.4, current: Number(share.toFixed(3)), unit: `share of other claims with "${f.concordance.family}"` });
      }
      f.falsifiers = fs;
    }
  }
  emit({ type: 'action', plan: plan2 });

  // ---- 12. Evidence gate ----
  const rt = redteam as Extract<InvestigationEvent, { type: 'redteam' }> | null;
  const vision = opts.vision;
  const corroborated = (f: CauseFinding) =>
    (f.concordance.family !== 'general' && f.concordance.share >= 0.4) ||
    // Only a live model reading of a photo counts; the offline reference analysis never does.
    (f.concordance.family === 'connector' && Boolean(vision?.live && vision.isManufacturingDefectLikely));
  const criteria: GateCriterion[] = [
    { id: 'sig', label: 'Association beats multiple-testing bar', pass: confirmed.every((c) => c.test.p < alpha), detail: confirmed.map((c) => `${c.hot}: ${c.node.rawTest?.pLabel}`).join('; ') + ` (Bonferroni alpha ${alpha.toExponential(1)})` },
    {
      id: 'confound',
      label: 'Survives adjustment for every other suspect',
      pass: confirmed.every((c) => (c.node.adjusted ?? []).every((a) => a.aliased || a.p < alpha)),
      detail: confirmed.map((c) => `${c.hot}: ${(c.node.adjusted ?? []).map((a) => `${a.controlFor} ${a.pLabel}`).join(', ') || 'no other suspects'}`).join(' | '),
    },
    // Zero stratifications is not consistency: with nothing to stratify by, the criterion fails.
    { id: 'robust', label: 'Effect consistent in every subgroup', pass: robustnessOut.length > 0 && robustnessOut.every((r) => r.consistent), detail: robustnessOut.length ? `${robustnessOut.filter((r) => r.consistent).length}/${robustnessOut.length} stratifications consistent` : 'No other factor to stratify by, so consistency could not be checked' },
    {
      id: 'residual',
      label: 'Nothing unexplained remains',
      pass: residual.length === 0,
      detail: residual.length
        ? `Structure remains after removing the causes: ${residual.map((r) => `${r.dim.column}=${r.hot} (${r.pLabel})`).join(', ')}`
        : `Causes explain ${(coverage * 100).toFixed(1)}% of claims; the rest is spread evenly across all ${dims.length} factors`,
    },
    {
      id: 'corroborate',
      label: 'Consistent failure signature',
      na: !cap.symptoms,
      pass: cap.symptoms ? causeList.every(corroborated) : true,
      detail: cap.symptoms
        ? causeList.map((f) => `${f.group}: ${Math.round(f.concordance.share * f.concordance.claims)}/${f.concordance.claims} "${f.concordance.family}"${f.concordance.family === 'connector' && vision ? ', photo: ' + vision.suspectedComponent : ''}`).join('; ')
        : 'Not assessable: the data has no symptom column',
    },
    { id: 'redteam', label: 'Red-team objections answered', pass: Boolean(rt && rt.objections.every((o) => o.survived)), detail: rt ? `${rt.objections.filter((o) => o.survived).length}/${rt.objections.length} answered with evidence` : 'not run' },
    {
      id: 'scope',
      label: 'Scope mapped to exact units',
      pass: causeList.every((f) => f.units > 0 && (f.remedy !== 'QUARANTINE' || f.lots.length > 0 || !cap.lineage)),
      detail: causeList.map((f) => (f.lots.length ? `${f.group}: ${f.lots.length} lot(s)` : `${f.group}: ${f.units.toLocaleString('en-US')} units`)).join('; '),
    },
  ];
  const pass = criteria.filter((c) => !c.na).every((c) => c.pass);
  emit({ type: 'gate', pass, criteria, blanket: { units: mesh.units.length, costUsd: mesh.units.length * unitCost } });

  const hitLots = new Set(causeList.filter((f) => f.remedy === 'QUARANTINE').flatMap((f) => f.lots.map((l) => l.lot_id)));
  updateWorldModel(
    mesh.lots.map((l) => ({
      lotId: l.lot_id,
      signalCount: mesh.claims.filter((c) => c.lot_id === l.lot_id).length,
      anomalyScore: hitLots.has(l.lot_id) ? Math.min(100, Math.round(primary.test.negLog10P)) : 2,
      status: hitLots.has(l.lot_id) ? 'INVESTIGATING' : 'ACTIVE',
      lastUpdated: new Date().toISOString(),
    })),
    scenarioId
  );
  const world = readWorldModel(scenarioId);
  if ([...hitLots].some((id) => world[id]?.status === 'QUARANTINED')) log('World model: affected lot(s) already quarantined', 'good');

  // ---- 13. Explanation with number guard ----
  emit({ type: 'phase', phase: 'explain', label: 'Writing the explanation' });
  const tl = timeline;
  const facts = {
    product: mesh.custom ? mesh.scenario.label : PRODUCT_NAME,
    custom: Boolean(mesh.custom),
    subgroupFactors: [...new Set(robustnessOut.map((r) => dims.find((d) => d.column === r.factor)?.title ?? r.factor))].join(', '),
    causes: causeList.map((f) => ({
      cause: `${f.title}: ${f.supplier ? `${f.supplier} ` : ''}${f.group}`,
      remedy: REMEDY[f.remedy].label,
      units: f.units,
      incidents: f.failures,
      ratePer10k: Number(f.ratePer10k.toFixed(1)),
      relativeRisk: Math.round(f.rr.rr),
      lots: f.lots.slice(0, 3).map((l) => `${l.lot_id} (plant ${l.plant_id}, built ${l.build_start} to ${l.build_end}, serials SN-${l.serial_start} to SN-${l.serial_end})`),
      lotCount: f.lots.length,
      signature: f.concordance.family,
    })),
    ruledOut: [...nodes.values()]
      .filter((n) => n.status !== 'CONFIRMED')
      .map((n) => ({ id: n.id, title: n.title, kind: n.status === 'CONFOUNDED' ? 'confounder: looked guilty, explained away by the cause' : 'no association at all', verdict: n.verdict })),
    coveragePct: Number((coverage * 100).toFixed(1)),
    affectedUnits: plan2.affectedUnits,
    blanketUnits: plan2.blanketUnits,
    surgicalCostUsd: plan2.surgicalCostUsd,
    savingsUsd: plan2.savingsUsd,
    incidentsSoFar: plan2.incidentsSoFar,
    projectedIncidents30d: plan2.projectedIncidents30d,
    alertDate: tl.alertDate,
    claimsAtAlert: tl.claimsAtAlert,
    gatePassed: pass,
    visionCorroborated: causeList.some((f) => f.concordance.family === 'connector') && Boolean(vision?.isManufacturingDefectLikely),
  };
  const narrative = await explain(facts, causeTemplate(facts), log);
  emit({ type: 'narrative', ...narrative });
  record({ kind: 'model', label: 'Explanation', summary: `${narrative.guard.verified}/${narrative.guard.checked} figures verified against evidence`, payload: narrative.text });

  emitForest();
  finish(!pass);
}

// ---------- Helpers ----------

/** Collapse grouped rows into 2xK strata: exposure = (exposure == hot), strata by `stratumHot` indicator or raw value. */
function collapseStrata(rows: Record<string, unknown>[], hot: string, stratumHot: string | null, stratumName: string): Stratum[] {
  const map = new Map<string, Stratum>();
  for (const r of rows) {
    const raw = String(r.stratum);
    const key = stratumHot === null ? raw : raw === stratumHot ? `${stratumName}=${stratumHot}` : `${stratumName}!=${stratumHot}`;
    const s = map.get(key) ?? { stratum: key, exposedUnits: 0, exposedFailures: 0, unexposedUnits: 0, unexposedFailures: 0 };
    const units = Number(r.units);
    const failures = Number(r.failures);
    if (String(r.exposure) === hot) {
      s.exposedUnits += units;
      s.exposedFailures += failures;
    } else {
      s.unexposedUnits += units;
      s.unexposedFailures += failures;
    }
    map.set(key, s);
  }
  return [...map.values()].filter((s) => s.exposedUnits > 0 && s.unexposedUnits > 0).sort((a, b) => a.stratum.localeCompare(b.stratum));
}

function earlyWarningReplay(scenarioId: string, column: string, hot: string) {
  const { units, claims, asOf } = getEnterpriseMesh(scenarioId);
  const unitBySerial = new Map(units.map((u) => [u.serial, u]));
  const groupUnits = new Map<string, number>();
  for (const u of units) {
    const g = String((u as unknown as Record<string, unknown>)[column]);
    groupUnits.set(g, (groupUnits.get(g) ?? 0) + 1);
  }
  const totalUnits = units.length;
  const threshold = -Math.log10(0.01 / groupUnits.size); // Bonferroni over every group scanned
  const first = claims[0]?.filed_date ?? asOf;
  const days: { date: string; claims: number; negLog10P: number }[] = [];
  let alertDate: string | null = null;
  let claimsAtAlert = 0;
  const start = Date.parse(first) - 3 * 86_400_000;
  for (let t = start; t <= Date.parse(asOf); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const fails = new Map<string, number>();
    let total = 0;
    for (const c of claims) {
      if (c.filed_date > date) break;
      const g = String((unitBySerial.get(c.serial) as unknown as Record<string, unknown>)[column]);
      fails.set(g, (fails.get(g) ?? 0) + 1);
      total++;
    }
    const hf = fails.get(hot) ?? 0;
    const hu = groupUnits.get(hot) ?? 1;
    const test = chiSquareIndependence([
      { group: hot, units: hu, failures: hf },
      { group: 'rest', units: totalUnits - hu, failures: total - hf },
    ]);
    const excess = hf / hu > (total - hf) / Math.max(1, totalUnits - hu);
    const score = excess && hf >= 3 ? test.negLog10P : 0;
    days.push({ date, claims: hf, negLog10P: Number(Math.min(score, 60).toFixed(2)) });
    if (!alertDate && score >= threshold) {
      alertDate = date;
      claimsAtAlert = hf;
    }
  }
  const finalClaims = days[days.length - 1]?.claims ?? 0;
  return { days, threshold: Number(threshold.toFixed(2)), alertDate, firstClaimDate: first, claimsAtAlert, claimsAfterAlert: alertDate ? finalClaims - claimsAtAlert : 0 };
}

async function planHypotheses(conv: Convergence, vision: VisionFinding | null, scenarioId: string, log: (t: string, tone?: 'warn') => void, dims: Dimension[]) {
  const catalog = dims.map((d) => ({ id: d.id, title: d.title, claim: d.claim }));
  const fallbackRationale: Record<string, string> =
    scenarioId === 'reference'
      ? {
          'H-FW': 'Customers mention recent firmware updates (v3.2 and v3.4) in posts.',
          'H-CARRIER': 'A customer blames UPS shipping damage for swelling.',
          'H-HEAT': 'Cluster is concentrated in Phoenix and Austin; one post blames 101F heat.',
          'H-PLANT': 'Packs differ by assembly plant; plant processes affect weld quality.',
          'H-BMS': 'Overcharge can come from the battery-management board, not firmware.',
          'H-SUPPLIER': 'Cell quality varies by supplier.',
          'H-BATCH': 'Several posts say the pack is "from early October", hinting at a production window.',
        }
      : {
          'H-FW': 'Firmware releases change charge limits fleet-wide.',
          'H-CARRIER': 'Transit damage can cause swelling and internal shorts.',
          'H-HEAT': 'Ambient heat accelerates cell degradation.',
          'H-PLANT': 'Assembly processes differ between plants.',
          'H-BMS': 'Battery-management boards control charge and cut-off.',
          'H-SUPPLIER': 'Cell quality varies by supplier.',
          'H-BATCH': 'A single bad incoming batch is the classic recall pattern.',
        };
  // Planning needs structured output quickly: the lightweight model, thinking off (~3s).
  const reply = await nemotronChat({
    model: NEMOTRON_FAST_MODEL,
    thinking: false,
    system: 'You are the planning module of Traceon, a product-safety root-cause agent. You rank hypotheses; you never compute statistics.',
    user: `Converged signals (H-MEM):\n${conv.matched.slice(0, 25).map((m) => `- ${m.content}`).join('\n')}\nCities: ${JSON.stringify(conv.cities)}\n${vision ? `Photo finding: ${vision.physicalFailureMode} at ${vision.suspectedComponent}\n` : ''}
Testable hypotheses (each maps to a SQL test the system will run):\n${JSON.stringify(catalog)}
Return ONLY JSON: {"ranking":[{"id":"H-...","rationale":"one sentence citing the signals"}], "untestable":["hypotheses worth investigating that this data cannot test"], "reasoning":"2 sentences"}
Rank ALL ids, most likely first.`,
    maxTokens: 2000,
    timeoutMs: 20_000,
  });
  if (reply.fallbackFrom) log(`${reply.fallbackFrom}; ${reply.via} planned instead`, 'warn');
  const parsed = reply.live ? extractJson<{ ranking: { id: string; rationale: string }[]; untestable?: string[]; reasoning?: string }>(reply.text) : null;
  if (!parsed && reply.error !== NO_PROVIDER) log(`Model planning unavailable (${reply.via ?? 'no provider answered'}: ${reply.error ?? 'reply was not valid JSON'}); testing every factor in catalog order`, 'warn');
  const ranked = (parsed?.ranking ?? []).filter((r) => dims.some((d) => d.id === r.id));
  const order = [...new Set([...ranked.map((r) => r.id), ...dims.map((d) => d.id)])];
  const hypotheses: HypothesisNode[] = order.map((id, i) => {
    const d = dims.find((x) => x.id === id)!;
    return { id, title: d.title, claim: d.claim, rationale: ranked.find((r) => r.id === id)?.rationale ?? fallbackRationale[id] ?? `${d.title} is one of the factors recorded in this data.`, priority: i + 1, status: 'QUEUED', silo: d.silo, evidenceIds: [] };
  });
  return {
    source: parsed ? ('nemotron' as const) : ('catalog' as const),
    ...(parsed ? { via: reply.via, by: aiName(reply) } : {}),
    reasoning: parsed?.reasoning ?? (reply.reasoning ? reply.reasoning.slice(0, 600) : 'Exhaustive screen of every testable factor in the federated mesh.'),
    // The model sometimes lists hypothesis ids here; only keep genuinely untestable ideas.
    untestable: (parsed?.untestable?.filter((u) => typeof u === 'string' && !/^H-[A-Z]+$/.test(u.trim())).slice(0, 4) ?? []).concat(
      parsed?.untestable?.some((u) => typeof u === 'string' && !/^H-[A-Z]+$/.test(u.trim())) ? [] : ['Customer charging habits (no charger telemetry)', 'Counterfeit replacement packs (no authenticity data)']
    ),
    hypotheses,
  };
}

async function redTeam(
  causes: Screened[],
  ctx: {
    alpha: number;
    granularity: Map<string, { pLabel: string; implicated: boolean }>;
    exposure: Map<string, { exposedDays: number; otherDays: number }>;
    geoCmh: Map<string, CmhResult>;
    geoBy: Map<string, string>;
    robustnessOut: RobustnessRow[];
    screenedCount: number;
    batches: number;
  },
  log: (t: string, tone?: 'warn') => void
): Promise<Extract<InvestigationEvent, { type: 'redteam' }>> {
  // Each objection type maps to a deterministic check, run for every confirmed cause.
  const perCause: Record<string, (c: Screened) => { result: string; survived: boolean } | null> = {
    confounding: (c) => {
      const adj = (c.node.adjusted ?? []).filter((a) => !a.aliased);
      return { survived: adj.every((a) => a.p < ctx.alpha), result: adj.length ? `${c.hot} still significant controlling for ${adj.map((a) => `${a.controlFor} (${a.pLabel})`).join(', ')}` : `${c.hot}: no other factor was significant on raw data` };
    },
    geography: (c) => {
      const g = ctx.geoCmh.get(c.node.id);
      const by = ctx.geoBy.get(c.node.id) ?? 'warehouse';
      return g
        ? { survived: g.p < ctx.alpha, result: `Within each ${by} ${c.hot} still fails far more often (CMH ${formatP(g.p, g.negLog10P)}).${by === 'warehouse' ? ' Regional reporting habits cannot explain it.' : ''}` }
        : null;
    },
    exposure_time: (c) => {
      const e = ctx.exposure.get(c.node.id);
      if (!e) return null;
      const less = e.exposedDays <= e.otherDays;
      // If exposed units are older, the robustness strata (same warehouse/firmware/carrier) still hold; report honestly.
      return {
        survived: less || ctx.robustnessOut.filter((r) => r.cause === c.hot).every((r) => r.consistent),
        result: `${c.hot} units: ${e.exposedDays.toFixed(1)} days in field on average vs ${e.otherDays.toFixed(1)} for others. ${less ? 'Less exposure yet more failures, so wear-out bias works against the finding.' : 'Slightly more exposure, but the effect size is far beyond what age explains and holds within every subgroup.'}`,
      };
    },
    chance: (c) => ({ survived: c.test.p < ctx.alpha, result: `${c.hot}: ${formatP(c.test.p, c.test.negLog10P)} after testing ${ctx.screenedCount} hypotheses; Bonferroni alpha ${ctx.alpha.toExponential(1)}` }),
    granularity: (c) => {
      const g = ctx.granularity.get(c.node.id);
      return g ? { survived: !g.implicated, result: g.implicated ? `Other batches from the same supplier are also elevated (${g.pLabel}): widen scope to the supplier.` : `Other batches from the same supplier fail at baseline (${g.pLabel}). The defect is specific to ${c.hot}.` } : null;
    },
    subgroups: (c) => {
      const rows = ctx.robustnessOut.filter((r) => r.cause === c.hot);
      return { survived: rows.every((r) => r.consistent), result: `${c.hot}: ${rows.map((r) => `${r.factor} ${r.consistent ? 'consistent' : 'inconsistent'}`).join(', ')}` };
    },
  };
  const check = (name: string) => {
    const fn = perCause[name];
    if (!fn) return null;
    const results = causes.map(fn).filter((x): x is { result: string; survived: boolean } => Boolean(x));
    if (!results.length) return null;
    return { survived: results.every((r) => r.survived), result: results.map((r) => r.result).join(' ') };
  };
  const defaults = [
    { objection: 'Hot climates could be cooking these packs instead.', check: 'confounding' },
    { objection: 'Some regions may simply complain more, inflating claims.', check: 'geography' },
    { objection: 'Older units fail more; maybe these units have just been in use longer.', check: 'exposure_time' },
    { objection: 'With this many groups tested, one will look bad by chance.', check: 'chance' },
    { objection: 'Maybe the problem is broader and we are about to under-recall.', check: 'granularity' },
    { objection: 'An average can hide subgroups where the effect reverses.', check: 'subgroups' },
  ];
  const verdicts = causes.map((c) => c.node.verdict).join(' ');
  // The red team needs structured output fast: the lightweight model, thinking off.
  const reply = await nemotronChat({
    model: NEMOTRON_FAST_MODEL,
    thinking: false,
    system: 'You are a skeptical product-safety statistician red-teaming a root-cause verdict. Be adversarial and specific.',
    user: `Verdict under review: ${verdicts}\nAvailable deterministic checks: ${Object.keys(perCause).join(', ')}.\nCheck meanings: confounding = effect persists after adjusting for each other measured factor; geography = effect persists within every warehouse; exposure_time = units' time in field; chance = multiple-testing correction; granularity = whether the wider supplier is affected; subgroups = effect consistent in every subgroup.
Map each objection to the ONE check that directly tests it. If an objection concerns something the data does not measure (unmeasured variables, data-entry errors, user behaviour), use "untestable".
Return ONLY JSON: {"objections":[{"objection":"strongest specific challenge","check":"one of the check names, or 'untestable'"}],"reasoning":"1-2 sentences"}. Give 4-6 objections.`,
    maxTokens: 1500,
    timeoutMs: 20_000,
  });
  const parsed = reply.live ? extractJson<{ objections: { objection: string; check: string }[]; reasoning?: string }>(reply.text) : null;
  if (reply.fallbackFrom) log(`${reply.fallbackFrom}; ${reply.via} red-teamed instead`, 'warn');
  if (!parsed?.objections?.length && reply.error !== NO_PROVIDER) log(`Model red team unavailable (${reply.via ?? 'no provider answered'}: ${reply.error ?? 'reply was not valid JSON'}); using built-in objections`, 'warn');
  const list = parsed?.objections?.length ? parsed.objections.slice(0, 6) : defaults;
  const objections = list
    .map((o) => {
      const r = check(o.check);
      if (!perCause[o.check]) return { objection: o.objection, check: 'untestable', result: 'Cannot be tested with the federated data available; logged as an open question for the quality team.', survived: true };
      return r ? { objection: o.objection, check: o.check, ...r } : null;
    })
    .filter((x): x is { objection: string; check: string; result: string; survived: boolean } => Boolean(x));
  return { type: 'redteam', source: parsed ? 'nemotron' : 'built-in', ...(parsed ? { via: reply.via } : {}), objections, reasoning: parsed?.reasoning ?? reply.reasoning.slice(0, 500) };
}

type CauseFacts = {
  product: string;
  custom: boolean;
  subgroupFactors: string;
  causes: { cause: string; remedy: string; units: number; incidents: number; relativeRisk: number; lots: string[]; lotCount: number; signature: string }[];
  ruledOut: { title: string; verdict?: string }[];
  coveragePct: number;
  affectedUnits: number;
  blanketUnits: number;
  savingsUsd: number;
  incidentsSoFar: number;
  projectedIncidents30d: number;
  alertDate: string | null;
  claimsAtAlert: number;
  visionCorroborated: boolean;
};

function causeTemplate(f: CauseFacts): string {
  const confounders = f.ruledOut.filter((r) => r.verdict?.includes('confounder'));
  const flat = f.ruledOut.filter((r) => r.verdict?.startsWith('Ruled out. Failure rate is flat'));
  const describe = (c: CauseFacts['causes'][number]) =>
    `${c.cause} (${c.incidents} incidents, ${c.relativeRisk}x the baseline rate${c.lots.length ? `; ${c.lotCount === 1 ? c.lots[0] : `${c.lotCount} lots`}` : ''})`;
  return [
    `Traceon traced ${f.incidentsSoFar} ${f.custom ? `failures in ${f.product}` : 'thermal incidents on the VR-48 pack'} to ${f.causes.length === 1 ? describe(f.causes[0]) : `${f.causes.length} independent causes: ${f.causes.map(describe).join('; and ')}`}. Together they account for ${f.coveragePct}% of all ${f.custom ? 'failures' : 'thermal claims'}.`,
    `${flat.length ? `${flat.map((r) => r.title).join(', ')} showed no association at all. ` : ''}${confounders.length ? `${confounders.map((r) => r.title).join(', ')} looked guilty on raw numbers only because ${confounders.length === 1 ? 'it shares' : 'they share'} units with the real cause; holding the cause fixed, the effect vanishes.` : 'No other suspect survived adjustment.'}`,
    `Each confirmed cause survives adjustment for every other factor, holds across ${f.custom ? `${f.subgroupFactors} subgroups` : 'firmware, carrier, climate and warehouse subgroups'}, and has a consistent failure signature${f.visionCorroborated ? ' that matches the photo evidence of connector scorching' : ''}.`,
    `Recommended action: ${f.causes.map((c) => `${c.remedy.toLowerCase()} for ${c.units.toLocaleString('en-US')} units`).join(' plus ')}, instead of recalling ${f.blanketUnits.toLocaleString('en-US')}, saving ${usd(f.savingsUsd)}. Without action, a constant-hazard projection gives about ${f.projectedIncidents30d} more incidents in 30 days.${f.alertDate ? ` This was detectable on ${f.alertDate}, after ${f.claimsAtAlert} claims.` : ''}`,
  ].join('\n\n');
}

function noCauseTemplate(f: { product: string; custom: boolean; claims: number; units: number; suspectsTested: number; bestSuspect: string; blanketRecallCostAvoidedUsd: number }): string {
  return [
    f.custom
      ? `Traceon investigated ${f.claims} failures across ${f.units.toLocaleString('en-US')} units of ${f.product} and tested all ${f.suspectsTested} suspects.`
      : `Traceon investigated ${f.claims} thermal claims across ${f.units.toLocaleString('en-US')} VR-48 packs and tested all ${f.suspectsTested} suspects.`,
    `None of them shows an association that survives multiple testing and adjustment for the others. The strongest was ${f.bestSuspect}. ${f.custom ? 'The failures show no structure the data can attribute to one factor' : 'The claims are spread evenly across firmware, carriers, plants, suppliers, batches and climates'}, which is what baseline failures look like.`,
    `Recommendation: do not recall. The evidence gate blocks any action, which avoids a blanket recall that would cost ${usd(f.blanketRecallCostAvoidedUsd)} and fix nothing. Keep monitoring and re-run as new claims arrive.`,
  ].join('\n\n');
}

/** Writes the explanation, then checks every number in it against the evidence facts. */
async function explain(facts: Record<string, unknown>, template: string, log: (t: string, tone?: 'warn') => void) {
  const prompt = {
    system: 'You are Traceon. Explain a product-safety root-cause finding to a VP of Quality. Use ONLY numbers that appear in the facts JSON. Do not round or invent figures. Respect each ruled-out suspect\'s "kind": never call a "no association" suspect a confounder.',
    user: `Facts:\n${JSON.stringify(facts, null, 2)}\n\nWrite 3-4 short paragraphs (max 170 words total): what happened, why the other suspects were ruled out, why the confirmed cause(s) are real (or why there is no actionable cause), and the recommended action with its cost impact. Plain text, no markdown headings.`,
  };
  let reply = await nemotronChat({
    ...prompt,
    thinking: true,
    thinkingDeadlineMs: Number(process.env.NEMOTRON_THINKING_DEADLINE_MS ?? 20_000),
    maxTokens: 4096,
    timeoutMs: 45_000,
  });
  // NIM latency on the large model spikes under load; the small model is a
  // better fallback than the template, and the same number guard applies.
  if (!(reply.live && reply.text.trim().length > 40) && reply.error !== NO_PROVIDER) {
    log(`Explanation model unavailable (${reply.error ?? 'empty reply'}); trying the fast route`, 'warn');
    reply = await nemotronChat({ ...prompt, model: NEMOTRON_FAST_MODEL, thinking: false, maxTokens: 900, timeoutMs: 25_000 });
  }
  const live = reply.live && reply.text.trim().length > 40;
  if (!live && reply.error !== NO_PROVIDER) log(`Model explanation unavailable (${reply.error ?? 'empty reply'}); using the template`, 'warn');
  const text = live ? reply.text.trim() : template;
  if (live && reply.fallbackFrom) log(`${reply.fallbackFrom}; ${reply.via} answered instead`, 'warn');
  return { source: live ? ('nemotron' as const) : ('template' as const), ...(live ? { via: reply.via, fallbackFrom: reply.fallbackFrom } : {}), text, reasoning: reply.reasoning.slice(0, 4000), cached: reply.cached, guard: numberGuard(text, facts) };
}

/** Hallucination guard: every figure in the explanation must exist in the evidence. */
export function numberGuard(text: string, facts: unknown) {
  const allowed = new Set<string>();
  const addNum = (n: number) => {
    allowed.add(String(n));
    allowed.add(n.toLocaleString('en-US'));
    allowed.add(n.toFixed(0));
    allowed.add(n.toFixed(1));
    if (Math.abs(n) >= 1000) {
      allowed.add(`${(n / 1e6).toFixed(2)}`);
      allowed.add(`${(n / 1e6).toFixed(1)}`);
      allowed.add(`${(n / 1e3).toFixed(0)}`);
    }
  };
  const walk = (v: unknown) => {
    if (typeof v === 'number') addNum(v);
    else if (typeof v === 'string') {
      // Unit shorthand in the evidence ("/10k", "$4.5M") also allows the spelled-out figure.
      for (const m of v.matchAll(/(\d+(?:\.\d+)?)\s*([kKmM])\b/g)) addNum(Number(m[1]) * (m[2].toLowerCase() === 'k' ? 1e3 : 1e6));
      for (const m of v.matchAll(/\d[\d,]*\.?\d*/g)) {
        allowed.add(m[0].replace(/\.$/, ''));
        const n = Number(m[0].replace(/,/g, '').replace(/\.$/, ''));
        if (!Number.isNaN(n)) addNum(n);
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  // Numbers that are part of identifiers (dates, lot/batch ids, serials) are checked as whole tokens.
  const tokens = [...text.matchAll(/(?<![\w-])\$?(\d[\d,]*(?:\.\d+)?)(%|x|M|K)?(?![\w-])/g)].map((m) => m[1].replace(/,$/, ''));
  const unverified = tokens.filter((t) => !allowed.has(t) && !allowed.has(t.replace(/,/g, '')) && !['1', '2', '3', '4', '30', '95'].includes(t));
  return { checked: tokens.length, verified: tokens.length - unverified.length, unverified: [...new Set(unverified)] };
}
