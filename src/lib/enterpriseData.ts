// Deterministic simulated enterprise silos for a fictional e-bike battery maker
// ("VoltRide VR-48 pack"). The same scenario always produces identical rows,
// so SQL proof hashes are reproducible and /api/verify can re-check them.
//
// Scenarios plant different hidden causes so the agent can be shown to reason
// rather than recite one answer. The agent is never given the scenario's truth;
// it is revealed only after the verdict.
//
// Reference scenario (the demo story):
//   - Cell batch CB-B-0917 from Supplier B, used only in lot L-409 (Plant 2,
//     Oct 2-4), has a ~9% thermal failure rate vs ~0.007% baseline.
//   - L-409 was shipped mostly to hot Sun Belt warehouses, so "heat exposure"
//     and "Plant 2" look guilty on raw data. They are confounders.

import { buildCustomMesh, getDataset } from './datasets';
import { singleton } from './singleton';

export const SKU = 'VR-48';
export const PRODUCT_NAME = 'VoltRide VR-48 48V E-Bike Battery Pack';
export const UNIT_COST_USD = 25; // blended cost per recalled unit: logistics, replacement, handling
export const AS_OF = '2026-10-24';

export interface ProductionLot {
  lot_id: string;
  plant_id: string;
  line_id: string;
  build_start: string;
  build_end: string;
  unit_count: number;
  serial_start: number;
  serial_end: number;
}

export interface BomLineage {
  lot_id: string;
  cell_supplier: string;
  cell_batch: string;
  bms_supplier: string;
}

export interface UnitFact {
  serial: string;
  serial_num: number;
  lot_id: string;
  plant_id: string;
  cell_supplier: string;
  cell_batch: string;
  bms_supplier: string;
  firmware: string;
  warehouse_id: string;
  region: string;
  climate_zone: 'SUNBELT' | 'TEMPERATE';
  carrier: string;
  ship_date: string;
  days_in_field: number;
  failed: number; // 1 if a thermal warranty claim exists for this serial
}

export interface WarrantyClaim {
  claim_id: string;
  serial: string;
  lot_id: string;
  filed_date: string;
  region: string;
  symptom: string;
  severity: 'FIRE' | 'SMOKE' | 'SWELLING' | 'OVERHEAT';
  narrative: string;
}

export interface Warehouse {
  warehouse_id: string;
  city: string;
  climate_zone: 'SUNBELT' | 'TEMPERATE';
}

export const WAREHOUSES: Warehouse[] = [
  { warehouse_id: 'WH-PHX', city: 'Phoenix, AZ', climate_zone: 'SUNBELT' },
  { warehouse_id: 'WH-AUS', city: 'Austin, TX', climate_zone: 'SUNBELT' },
  { warehouse_id: 'WH-ATL', city: 'Atlanta, GA', climate_zone: 'SUNBELT' },
  { warehouse_id: 'WH-DEN', city: 'Denver, CO', climate_zone: 'TEMPERATE' },
  { warehouse_id: 'WH-CHI', city: 'Chicago, IL', climate_zone: 'TEMPERATE' },
  { warehouse_id: 'WH-SEA', city: 'Seattle, WA', climate_zone: 'TEMPERATE' },
  { warehouse_id: 'WH-NJ', city: 'Newark, NJ', climate_zone: 'TEMPERATE' },
];

const CARRIERS = ['FedEx', 'UPS', 'DHL'];
const FIRMWARE = [
  { v: 'v3.2', w: 0.3 },
  { v: 'v3.3', w: 0.3 },
  { v: 'v3.4', w: 0.4 },
];

// ---------- Scenarios ----------
export type CauseColumn = 'cell_batch' | 'firmware' | 'carrier' | 'plant_id' | 'bms_supplier' | 'cell_supplier';
type SymptomKind = 'connector' | 'charging' | 'transit' | 'assembly' | 'bms';

export interface PlantedCause {
  column: CauseColumn;
  group: string;
  rate: number;
  /** Lot-specific defects fail at a flat rate soon after shipping; others ramp with field time. */
  flat: boolean;
  symptom: SymptomKind;
}

export interface Scenario {
  id: string;
  label: string;
  blurb: string;
  hidden: boolean; // random scenarios hide the description until the verdict
  causes: PlantedCause[];
  baselineRate: number;
  /** Lot whose shipments skew to the Sun Belt (creates the heat confounder). */
  skewLot?: string;
  /** Firmware version rolled out first in the Sun Belt (heat confounder for firmware bugs). */
  skewFirmware?: string;
  /** Investigate as of this date: only claims filed and units shipped by then exist. */
  asOf?: string;
  /** Planted causes are known (generated data), so the verdict can be scored. */
  truthKnown: boolean;
  /** Uploaded dataset rather than generated data. */
  custom?: boolean;
}

/** A testable factor: one column in unit_fact and the hypothesis it stands for. */
export interface DimensionSpec {
  id: string;
  column: string;
  title: string;
  claim: string;
  silo: string;
}

export { SCENARIO_OPTIONS } from './scenarioOptions';
export type { ScenarioOption } from './scenarioOptions';
import { SCENARIO_OPTIONS } from './scenarioOptions';

const REFERENCE_BATCH = 'CB-B-0917';
const REFERENCE_LOT = 'L-409';
const LOT_IDS = Array.from({ length: 60 }, (_, i) => `L-${401 + i}`);

export function resolveScenario(id: string | undefined | null): Scenario {
  const full = id || 'reference';
  const m = full.match(/^(.+?)(?:@(\d{4}-\d{2}-\d{2}))?$/);
  const base = m?.[1] ?? full;
  const asOf = m?.[2];
  if (asOf && (Number.isNaN(Date.parse(asOf)) || asOf > AS_OF)) throw new Error(`Invalid as-of date "${asOf}"`);
  let s: Scenario;
  if (/^custom-[a-f0-9]{12}$/.test(base)) {
    const ds = getDataset(base);
    if (!ds) throw new Error(`Unknown dataset "${base}"`);
    s = { id: base, label: ds.name, blurb: `Uploaded data: ${ds.rows.length.toLocaleString('en-US')} units, ${ds.mapping.factors.length} factors`, hidden: false, causes: [], baselineRate: 0, truthKnown: false, custom: true };
  } else {
    s = resolveBaseScenario(base);
  }
  if (!asOf) return s;
  return { ...s, id: `${s.id}@${asOf}`, label: `${s.label} (as of ${asOf})`, asOf };
}

function resolveBaseScenario(sid: string): Scenario {
  const batchCause = (group: string, rate = 0.09): PlantedCause => ({ column: 'cell_batch', group, rate, flat: true, symptom: 'connector' });
  const fwCause = (group: string, rate: number): PlantedCause => ({ column: 'firmware', group, rate, flat: false, symptom: 'charging' });
  if (sid === 'reference') {
    return { id: sid, label: SCENARIO_OPTIONS[0].label, blurb: SCENARIO_OPTIONS[0].blurb, hidden: false, causes: [batchCause(REFERENCE_BATCH)], baselineRate: 0.00007, skewLot: REFERENCE_LOT, truthKnown: true };
  }
  if (sid === 'firmware') {
    return { id: sid, label: SCENARIO_OPTIONS[1].label, blurb: SCENARIO_OPTIONS[1].blurb, hidden: false, causes: [fwCause('v3.4', 0.0018)], baselineRate: 0.00007, skewFirmware: 'v3.4', truthKnown: true };
  }
  if (sid === 'two-causes') {
    return { id: sid, label: SCENARIO_OPTIONS[2].label, blurb: SCENARIO_OPTIONS[2].blurb, hidden: false, causes: [batchCause(REFERENCE_BATCH), fwCause('v3.4', 0.0014)], baselineRate: 0.00007, skewLot: REFERENCE_LOT, truthKnown: true };
  }
  if (sid === 'noise') {
    return { id: sid, label: SCENARIO_OPTIONS[3].label, blurb: SCENARIO_OPTIONS[3].blurb, hidden: false, causes: [], baselineRate: 0.0006, truthKnown: true };
  }
  const m = sid.match(/^random-(\d{1,9})$/);
  if (!m) throw new Error(`Unknown scenario "${sid}"`);
  const seed = Number(m[1]);
  const r = mulberry32(seed * 7919 + 13);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const kind = pick(['cell_batch', 'firmware', 'plant_id', 'carrier', 'bms_supplier', 'two', 'none'] as const);
  const base = { id: sid, label: `Hidden scenario #${seed}`, hidden: true, baselineRate: 0.00007, truthKnown: true };
  const lotIdx = Math.floor(r() * 60);
  const batch = batchIdFor(lotIdx, supplierFor(sid, lotIdx));
  switch (kind) {
    case 'cell_batch':
      return { ...base, blurb: `Defective cell batch ${batch} (lot ${LOT_IDS[lotIdx]})`, causes: [batchCause(batch, between(0.06, 0.1))], skewLot: LOT_IDS[lotIdx] };
    case 'firmware': {
      const v = pick(['v3.2', 'v3.3', 'v3.4']);
      return { ...base, blurb: `Firmware ${v} overcharge bug`, causes: [fwCause(v, between(0.0016, 0.0024))], skewFirmware: r() < 0.5 ? v : undefined };
    }
    case 'plant_id': {
      const p = pick(['P1', 'P2', 'P3']);
      return { ...base, blurb: `Assembly process defect at plant ${p}`, causes: [{ column: 'plant_id', group: p, rate: between(0.001, 0.0014), flat: false, symptom: 'assembly' }] };
    }
    case 'carrier': {
      const c = pick(CARRIERS);
      return { ...base, blurb: `Transit damage by ${c}`, causes: [{ column: 'carrier', group: c, rate: between(0.0011, 0.0015), flat: false, symptom: 'transit' }] };
    }
    case 'bms_supplier': {
      const b = pick(['BMS-Kestrel', 'BMS-Orion']);
      return { ...base, blurb: `Faulty boards from ${b}`, causes: [{ column: 'bms_supplier', group: b, rate: between(0.0009, 0.0012), flat: false, symptom: 'bms' }] };
    }
    case 'two': {
      const v = pick(['v3.2', 'v3.3', 'v3.4']);
      return { ...base, blurb: `Two causes: cell batch ${batch} and firmware ${v}`, causes: [batchCause(batch, between(0.06, 0.1)), fwCause(v, between(0.0014, 0.002))], skewLot: LOT_IDS[lotIdx] };
    }
    default:
      return { ...base, blurb: 'No defect: baseline noise only', causes: [], baselineRate: 0.0006 };
  }
}

/** Ground truth for scoring the agent after the verdict. */
export function scenarioTruth(s: Scenario) {
  return s.causes.map((c) => ({ column: c.column, group: c.group }));
}

// Reference keeps its historical plant<->supplier mapping (so the demo data is
// unchanged); other scenarios assign suppliers independently of plants, so a
// plant defect and a supplier defect are distinguishable.
function supplierFor(scenarioId: string, i: number): string {
  if (LOT_IDS[i] === REFERENCE_LOT) return 'Supplier B';
  if (scenarioId === 'reference' || scenarioId === 'two-causes') return ['Supplier A', 'Supplier B', 'Supplier C'][i % 3];
  const r = mulberry32(1000 + i * 31);
  return ['Supplier A', 'Supplier B', 'Supplier C'][Math.floor(r() * 3)];
}

function batchIdFor(i: number, supplier: string): string {
  if (LOT_IDS[i] === REFERENCE_LOT) return REFERENCE_BATCH;
  return `CB-${supplier.slice(-1)}-${String(800 + i * 3).padStart(4, '0')}`;
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

const DAY = 86_400_000;
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const asOfMs = Date.parse(AS_OF);

function pickWeighted<T>(rand: () => number, items: { v: T; w: number }[]): T {
  let r = rand();
  for (const it of items) {
    if ((r -= it.w) <= 0) return it.v;
  }
  return items[items.length - 1].v;
}

const SEVERITY: Record<SymptomKind | 'baseline', { v: WarrantyClaim['severity']; w: number }[]> = {
  connector: [
    { v: 'OVERHEAT', w: 0.45 },
    { v: 'SMOKE', w: 0.25 },
    { v: 'SWELLING', w: 0.2 },
    { v: 'FIRE', w: 0.1 },
  ],
  charging: [
    { v: 'OVERHEAT', w: 0.55 },
    { v: 'SMOKE', w: 0.3 },
    { v: 'FIRE', w: 0.15 },
  ],
  transit: [
    { v: 'SWELLING', w: 0.6 },
    { v: 'OVERHEAT', w: 0.4 },
  ],
  assembly: [
    { v: 'OVERHEAT', w: 0.6 },
    { v: 'SMOKE', w: 0.4 },
  ],
  bms: [
    { v: 'OVERHEAT', w: 0.7 },
    { v: 'SWELLING', w: 0.3 },
  ],
  baseline: [
    { v: 'OVERHEAT', w: 0.6 },
    { v: 'SWELLING', w: 0.4 },
  ],
};

const SYMPTOMS: Record<SymptomKind | 'baseline', string[]> = {
  connector: ['pack hot near discharge connector', 'burning smell from pack, scorch at connector pin 4', 'cell swelling, pack casing bulged', 'smoke while charging, connector discolored'],
  charging: ['pack overheated while charging, BMS error E07', 'charger cut out and pack was very hot', 'smoke from pack during overnight charge', 'pack hot to touch after full charge'],
  transit: ['casing dented on arrival, pack swelling', 'pack swelling a week after delivery, box was crushed', 'rattling inside pack, then overheating'],
  assembly: ['pack cuts out then overheats mid-ride', 'hot spot in the middle of the pack', 'loose cell interconnect, pack gets hot'],
  bms: ['pack shuts off then gets hot', 'battery percentage jumps around, pack warm', 'pack does not stop charging, gets hot'],
  baseline: ['pack warm after long climb', 'minor swelling after storage', 'pack hot while charging'],
};

export interface EnterpriseMesh {
  scenario: Scenario;
  lots: ProductionLot[];
  bom: BomLineage[];
  units: UnitFact[];
  claims: WarrantyClaim[];
  warehouses: Warehouse[];
  /** The date the data runs to. */
  asOf: string;
  /** Factors to test; generated data uses the seven built-in dimensions. */
  dimensions?: DimensionSpec[];
  custom?: boolean;
  /** Which optional analyses the data supports. */
  capabilities: { dates: boolean; symptoms: boolean; daysInField: boolean; warehouses: boolean; lineage: boolean };
}

const FULL_CAPABILITIES = { dates: true, symptoms: true, daysInField: true, warehouses: true, lineage: true };

// Each mesh is ~180k rows; keep a small cache.
const cache = singleton('meshes', () => new Map<string, EnterpriseMesh>());
const CACHE_MAX = 3;

export function getEnterpriseMesh(scenarioId: string = 'reference'): EnterpriseMesh {
  const scenario = resolveScenario(scenarioId);
  const hit = cache.get(scenario.id);
  if (hit) return hit;
  let mesh: EnterpriseMesh;
  if (scenario.asOf) {
    // A cutoff view of the full scenario: what was knowable on that date.
    const baseId = scenario.id.slice(0, scenario.id.indexOf('@'));
    mesh = cutoff(getEnterpriseMesh(baseId), scenario);
  } else if (scenario.custom) {
    mesh = buildCustomMesh(getDataset(scenario.id)!, scenario);
  } else {
    mesh = generate(scenario);
  }
  cache.set(scenario.id, mesh);
  while (cache.size > CACHE_MAX + 2) cache.delete(cache.keys().next().value!);
  return mesh;
}

/** Only units shipped and claims filed by the cutoff exist; time in field is recomputed. */
function cutoff(base: EnterpriseMesh, scenario: Scenario): EnterpriseMesh {
  const date = scenario.asOf!;
  const end = Date.parse(date);
  const claims = base.claims.filter((c) => c.filed_date <= date);
  const failedSerials = new Set(claims.map((c) => c.serial));
  const units = base.scenario.custom
    ? base.units.map((u) => ({ ...u, failed: failedSerials.has(u.serial) ? 1 : 0 }))
    : base.units
        .filter((u) => u.ship_date <= date)
        .map((u) => ({ ...u, days_in_field: Math.max(0, Math.round((end - Date.parse(u.ship_date)) / DAY)), failed: failedSerials.has(u.serial) ? 1 : 0 }));
  return { ...base, scenario, units, claims, asOf: date };
}

function generate(scenario: Scenario): EnterpriseMesh {
  // The unit stream is seeded identically for every scenario; scenario-specific
  // randomness uses separate streams, so the reference rows never change.
  const rand = mulberry32(409);

  // 60 lots, 180,000 units total; L-409 is a short 1,380-unit run.
  const lots: ProductionLot[] = [];
  const bom: BomLineage[] = [];
  const otherCount = 59;
  const otherTotal = 180_000 - 1_380;
  const sizes: number[] = [];
  for (let i = 0; i < otherCount; i++) sizes.push(2_800 + Math.floor(rand() * 450));
  const drift = otherTotal - sizes.reduce((a, b) => a + b, 0);
  sizes[sizes.length - 1] += drift;

  let serial = 10_000;
  let sizeIdx = 0;
  const buildBase = Date.parse('2026-08-01');
  for (let i = 0; i < 60; i++) {
    const lotId = LOT_IDS[i];
    const isRefLot = lotId === REFERENCE_LOT;
    const unitCount = isRefLot ? 1_380 : sizes[sizeIdx++];
    const plant = isRefLot ? 'P2' : `P${(i % 3) + 1}`;
    const start = isRefLot ? Date.parse('2026-10-02') : buildBase + i * 1.15 * DAY;
    const end = start + (isRefLot ? 2 : 1 + Math.floor(rand() * 2)) * DAY;
    // L-409 owns the serial block SN-88400..SN-89779; other lots skip it.
    if (!isRefLot && serial + unitCount > 88_400 && serial <= 89_779) serial = 89_780;
    const serialStart = isRefLot ? 88_400 : serial;
    if (!isRefLot) serial += unitCount;
    lots.push({
      lot_id: lotId,
      plant_id: plant,
      line_id: `${plant}-LN${1 + (i % 2)}`,
      build_start: toDate(start),
      build_end: toDate(end),
      unit_count: unitCount,
      serial_start: serialStart,
      serial_end: serialStart + unitCount - 1,
    });
    const supplier = supplierFor(scenario.id, i);
    bom.push({ lot_id: lotId, cell_supplier: supplier, cell_batch: batchIdFor(i, supplier), bms_supplier: i % 2 ? 'BMS-Kestrel' : 'BMS-Orion' });
  }

  const bomByLot = new Map(bom.map((b) => [b.lot_id, b]));
  const units: UnitFact[] = [];
  const claims: WarrantyClaim[] = [];
  let claimSeq = 5_000;

  for (const lot of lots) {
    const b = bomByLot.get(lot.lot_id)!;
    const skewed = lot.lot_id === scenario.skewLot;
    const buildEnd = Date.parse(lot.build_end);
    for (let k = 0; k < lot.unit_count; k++) {
      const sn = lot.serial_start + k;
      const sunbelt = rand() < (skewed ? 0.72 : 0.42);
      const pool = WAREHOUSES.filter((w) => (sunbelt ? w.climate_zone === 'SUNBELT' : w.climate_zone === 'TEMPERATE'));
      const wh = skewed && sunbelt
        ? (rand() < 0.5 ? WAREHOUSES[0] : WAREHOUSES[1]) // Phoenix + Austin
        : pool[Math.floor(rand() * pool.length)];
      const shipMs = buildEnd + (2 + Math.floor(rand() * 5)) * DAY;
      const daysInField = Math.max(0, Math.round((asOfMs - shipMs) / DAY));
      // A firmware release pushed to the Sun Belt first makes heat look guilty.
      const fwWeights = scenario.skewFirmware
        ? FIRMWARE.map((f) => ({ v: f.v, w: f.v === scenario.skewFirmware ? (sunbelt ? 0.7 : 0.25) : sunbelt ? 0.15 : 0.375 }))
        : FIRMWARE;
      const firmware = pickWeighted(rand, fwWeights);
      const carrier = CARRIERS[Math.floor(rand() * 3)];

      const attrs: Record<CauseColumn, string> = { cell_batch: b.cell_batch, firmware, carrier, plant_id: lot.plant_id, bms_supplier: b.bms_supplier, cell_supplier: b.cell_supplier };
      const ramp = Math.min(1, daysInField / 30);
      let cause: PlantedCause | null = null;
      let p = scenario.baselineRate * ramp;
      for (const c of scenario.causes) {
        if (attrs[c.column] !== c.group) continue;
        const cp = c.flat ? c.rate : c.rate * ramp;
        if (cp > p) {
          p = cp;
          cause = c;
        }
      }

      let failed = 0;
      if (rand() < p) {
        const lag = cause?.flat ? 3 + Math.floor(rand() * 13) : 2 + Math.floor(rand() * Math.max(3, daysInField));
        const filed = shipMs + lag * DAY;
        if (filed <= asOfMs) {
          failed = 1;
          const kind = cause?.symptom ?? 'baseline';
          const severity = pickWeighted(rand, SEVERITY[kind]);
          const list = SYMPTOMS[kind];
          const symptom = list[Math.floor(rand() * list.length)];
          claims.push({
            claim_id: `WC-${claimSeq++}`,
            serial: `SN-${sn}`,
            lot_id: lot.lot_id,
            filed_date: toDate(filed),
            region: wh.city,
            symptom,
            severity,
            narrative: `${severity}: ${symptom}. Customer in ${wh.city}.`,
          });
        }
      }

      units.push({
        serial: `SN-${sn}`,
        serial_num: sn,
        lot_id: lot.lot_id,
        plant_id: lot.plant_id,
        cell_supplier: b.cell_supplier,
        cell_batch: b.cell_batch,
        bms_supplier: b.bms_supplier,
        firmware,
        warehouse_id: wh.warehouse_id,
        region: wh.city,
        climate_zone: wh.climate_zone,
        carrier,
        ship_date: toDate(shipMs),
        days_in_field: daysInField,
        failed,
      });
    }
  }

  claims.sort((a, b) => a.filed_date.localeCompare(b.filed_date) || a.claim_id.localeCompare(b.claim_id));
  return { scenario, lots, bom, units, claims, warehouses: WAREHOUSES, asOf: AS_OF, capabilities: FULL_CAPABILITIES };
}

// Simulated public chatter (stand-in for Bright Data review/forum scraping when
// no BRIGHTDATA_API_TOKEN is set). Deliberately vague: no serials, only city,
// symptom and product. H-MEM has to converge these weak signals.
export interface ChatterPost {
  id: string;
  channel: 'Reddit r/ebikes' | 'Amazon review' | 'Home Depot review' | 'Facebook group';
  date: string;
  city: string;
  text: string;
  rating?: number;
}

const REFERENCE_CHATTER: ChatterPost[] = [
  { id: 'BD-001', channel: 'Reddit r/ebikes', date: '2026-10-10', city: 'Phoenix, AZ', text: 'My VoltRide VR-48 pack got really hot near the discharge connector after a 10 mile ride. Anyone else?' },
  { id: 'BD-002', channel: 'Amazon review', date: '2026-10-11', city: 'Austin, TX', rating: 1, text: 'VR-48 battery smelled like burning plastic on the charger. Connector pin looks brown.' },
  { id: 'BD-003', channel: 'Facebook group', date: '2026-10-12', city: 'Phoenix, AZ', text: 'Second VR-48 in our group with a scorched connector. It is 101F here though, maybe heat?' },
  { id: 'BD-004', channel: 'Reddit r/ebikes', date: '2026-10-13', city: 'Denver, CO', text: 'VR-48 pack bulged, casing cracked near the connector end. Bought it two weeks ago.' },
  { id: 'BD-005', channel: 'Home Depot review', date: '2026-10-14', city: 'Austin, TX', rating: 1, text: 'Smoke came out of the VR-48 while charging in the garage. Returned it.' },
  { id: 'BD-006', channel: 'Reddit r/ebikes', date: '2026-10-15', city: 'Chicago, IL', text: 'Not hot here at all and my VR-48 still started smoking at the connector. Firmware 3.2.' },
  { id: 'BD-007', channel: 'Amazon review', date: '2026-10-16', city: 'Phoenix, AZ', rating: 2, text: 'Battery pin 4 on the VR-48 connector has a black burn mark. Updated to firmware 3.4 last week.' },
  { id: 'BD-008', channel: 'Facebook group', date: '2026-10-18', city: 'Seattle, WA', text: 'VR-48 swelling, shipped UPS. Seller says shipping damage, I am not sure.' },
  { id: 'BD-009', channel: 'Reddit r/ebikes', date: '2026-10-19', city: 'Austin, TX', text: 'Photo of my VR-48 connector: melted at one pin. Pack is from early October.' },
  { id: 'BD-010', channel: 'Amazon review', date: '2026-10-21', city: 'Atlanta, GA', rating: 1, text: 'VR-48 got too hot to touch near the connector. Fire department told me to stop using it.' },
];

export function getSimulatedChatter(scenarioId: string = 'reference'): ChatterPost[] {
  const sc = resolveScenario(scenarioId);
  if (sc.custom) return [];
  if (sc.asOf) {
    const base = sc.id.slice(0, sc.id.indexOf('@'));
    return getSimulatedChatter(base).filter((p) => p.date <= sc.asOf!);
  }
  if ((scenarioId || 'reference') === 'reference') return REFERENCE_CHATTER;
  // Other scenarios: paraphrase a spread of real claims into anonymous posts.
  const { claims } = getEnterpriseMesh(scenarioId);
  const channels: ChatterPost['channel'][] = ['Reddit r/ebikes', 'Amazon review', 'Facebook group', 'Home Depot review'];
  const step = Math.max(1, Math.floor(claims.length / 10));
  return claims
    .filter((_, i) => i % step === 0)
    .slice(0, 10)
    .map((c, i) => ({
      id: `BD-${String(i + 1).padStart(3, '0')}`,
      channel: channels[i % channels.length],
      date: c.filed_date,
      city: c.region,
      rating: i % 2 ? 1 : undefined,
      text: `My VoltRide VR-48: ${c.symptom}.`,
    }));
}
