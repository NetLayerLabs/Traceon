// Real figures for the film, read from the app's own engine and data (never typed by hand):
//   cd .. && npx tsx video/scripts/data.mts      (or: npm run data, from video/)
// Writes video/data/real.json. Offline like sample mode (no keys, model steps are templates),
// except the NHTSA complaint texts quoted on screen, which are fetched from api.nhtsa.gov.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const k of Object.keys(process.env)) if (/^(NVIDIA_|NEMOTRON_|NIGHTSHIFT_|ZETARIS_|BRIGHTDATA_|OPENFDA_|AI_PROVIDER)/.test(k)) delete process.env[k];
process.env.METERLESS_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-film-'));
process.env.NEMOTRON_CACHE = 'off';
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('offline');
}) as typeof fetch;

const { runInvestigation } = await import('../../src/lib/investigation.ts');
const { analyze, loadSnapshot, recallFollowUp } = await import('../../src/lib/realRecall.ts');
const { parseCsv, saveDataset } = await import('../../src/lib/datasets.ts');

const run = async (scenarioId: string) => {
  const ev: any[] = [];
  await runInvestigation((e) => ev.push(e), { scenarioId, pacingMs: 0, vision: null });
  return ev;
};
const last = (ev: any[], t: string) => ev.filter((e) => e.type === t).at(-1);
const nodes = (ev: any[]) => {
  const m = new Map<string, any>();
  for (const e of ev.filter((x) => x.type === 'hypothesis')) m.set(e.node.id, e.node);
  return [...m.values()];
};

// 1. The reference case (VoltRide is a simulated company; the film labels it).
const ref = await run('reference');
const conv = last(ref, 'convergence').data;
const plan = last(ref, 'action').plan;
const cause = plan.causes[0];
const gate = last(ref, 'gate');
const red = last(ref, 'redteam');
const ledger = last(ref, 'ledger');
const forest = last(ref, 'forest').rows;
const sqlExhibits = ref.filter((e) => e.type === 'evidence' && e.item?.query?.sql);
const reference = {
  company: 'VoltRide (simulated)',
  product: 'VR-48 48V e-bike battery pack',
  signals: { matched: conv.matched.length, total: conv.totalSignals, cities: conv.cities, channels: conv.channels, signature: conv.signature, firstSeen: conv.firstSeen, lastSeen: conv.lastSeen },
  hypotheses: nodes(ref).map((n) => ({
    id: n.id, title: n.title, status: n.status, group: n.hotGroup,
    rawP: n.rawTest?.pLabel ?? null,
    adjustedP: forest.find((r: any) => r.id === n.id)?.adjustedP ?? null,
    rr: forest.find((r: any) => r.id === n.id)?.rr ?? null,
    verdict: n.verdict,
  })),
  cause: {
    column: cause.column, group: cause.group, rr: cause.rr.rr, rrLo: cause.rr.lo, rrHi: cause.rr.hi, coverage: cause.coverage,
    units: cause.units, failures: cause.failures, ratePer10k: cause.ratePer10k, baseRatePer10k: cause.baseRatePer10k, lot: cause.lots[0],
    signature: cause.concordance,
  },
  plan: { affectedUnits: plan.affectedUnits, blanketUnits: plan.blanketUnits, savingsUsd: plan.savingsUsd, costUsd: cause.costUsd, blanketCostUsd: plan.savingsUsd + cause.costUsd },
  gate: { pass: gate.pass, criteria: gate.criteria.map((c: any) => ({ label: c.label, pass: c.pass, detail: c.detail })) },
  redteam: red.objections.map((o: any) => ({ objection: o.objection, survived: o.survived, result: o.result })),
  markovianSteps: last(ref, 'markovian')?.data?.steps ?? null,
  exhibits: ledger.count,
  sqlQueries: sqlExhibits.length,
  sampleSql: sqlExhibits.slice(0, 8).map((e) => ({ id: e.item.id, label: e.item.label, summary: e.item.summary, sql: e.item.query.sql, rows: e.item.query.rows?.slice(0, 6), silos: e.item.query.sourceSilos, proofHash: e.item.proofHash })),
  offlineLedgerRoot: ledger.root,
};

// 2. The Chevy Bolt EV: public NHTSA complaints and recalls (snapshot in data/nhtsa/).
const snap = loadSnapshot('bolt-ev')!;
const bt = analyze(snap);
const fu = recallFollowUp(snap, bt);
const fires = snap.complaints.filter((c: any) => c.f);
const quarter = (d: string) => `${d.slice(0, 4)} Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;
const quarters: Record<string, number> = {};
for (const q of ['2020 Q3', '2020 Q4', '2021 Q1', '2021 Q2', '2021 Q3', '2021 Q4', '2022 Q1', '2022 Q2']) quarters[q] = 0;
for (const c of fires) if (quarter(c.d) in quarters) quarters[quarter(c.d)]++;
globalThis.fetch = realFetch;
const quoted = ['11372429', '11426342'];
const full: Record<string, any> = {};
for (const y of [2017, 2018, 2019]) {
  try {
    const r = await fetch(`https://api.nhtsa.gov/complaints/complaintsByVehicle?make=CHEVROLET&model=BOLT%20EV&modelYear=${y}`, { signal: AbortSignal.timeout(40_000) });
    for (const c of ((await r.json()) as any).results ?? []) if (quoted.includes(String(c.odiNumber))) full[c.odiNumber] = c;
  } catch {}
}
const bolt = {
  vehicle: bt.vehicle,
  source: snap.source,
  fetchedAt: snap.fetchedAt,
  alert: bt.headline?.alert ?? null,
  recall: bt.headline?.recall ?? null,
  leadDays: bt.headline?.leadDays ?? null,
  verdict: bt.headline?.verdict ?? null,
  fireComplaints: fires.length,
  quarters,
  followUp: fu.map((f: any) => ({ campaign: f.campaign, date: f.date, verdict: f.verdict, before: f.before.fires, after: f.after.fires, afterComplaints: f.after.complaints, p: f.pDecrease, next: f.nextRecall, reason: f.reason })),
  recalls: snap.recalls.filter((r: any) => /TRACTION BATTERY/.test(r.component)).map((r: any) => ({ campaign: r.campaign, date: r.date, summary: r.summary })),
  quotes: quoted.map((odi) => ({
    odi,
    filed: full[odi]?.dateComplaintFiled ?? null,
    incident: full[odi]?.dateOfIncident ?? null,
    fire: full[odi]?.fire ?? null,
    text: full[odi]?.summary ?? snap.complaints.find((c: any) => c.o === odi)?.s ?? null,
  })),
};

// 3. Backblaze Drive Stats, Q2 2026: every drive in the fleet (public/samples).
globalThis.fetch = (async () => {
  throw new Error('offline');
}) as typeof fetch;
const table = parseCsv(fs.readFileSync('public/samples/backblaze-drives-q2-2026.csv', 'utf-8'));
const header = table[0];
const iFail = header.indexOf('failed');
const iModel = header.indexOf('model');
const iDc = header.indexOf('datacenter');
const rows = table.slice(1);
const ds = saveDataset('Backblaze Q2 2026', header, rows, { outcome: 'failed', failValues: ['yes'], factors: ['model', 'datacenter', 'age_band'], serial: 'serial', date: 'failure_date', daysInField: 'days_in_field' });
const bbEv = await run(ds.id);
const bbNodes = nodes(bbEv);
const model = bbNodes.find((n) => n.id === 'H-MODEL');
const worst = model?.hotGroup;
const rate = (pred: (r: string[]) => boolean) => {
  const s = rows.filter(pred);
  const f = s.filter((r) => r[iFail] === 'yes').length;
  return { units: s.length, failures: f, per10k: +(f / s.length * 1e4).toFixed(1) };
};
const backblaze = {
  drives: rows.length,
  failures: rows.filter((r) => r[iFail] === 'yes').length,
  worstModel: worst,
  worst: rate((r) => r[iModel] === worst),
  fleet: rate(() => true),
  worstInSac2: rate((r) => r[iModel] === worst && r[iDc] === 'sac2'),
  worstElsewhere: rate((r) => r[iModel] === worst && r[iDc] !== 'sac2'),
  othersInSac2: rate((r) => r[iModel] !== worst && r[iDc] === 'sac2'),
  othersElsewhere: rate((r) => r[iModel] !== worst && r[iDc] !== 'sac2'),
  rawP: model?.rawTest?.pLabel ?? null,
  gatePass: last(bbEv, 'gate')?.pass ?? null,
  verdicts: bbNodes.map((n) => ({ title: n.title, status: n.status, verdict: n.verdict })),
};

const out = { generatedAt: new Date().toISOString(), reference, bolt, backblaze };
fs.mkdirSync('video/data', { recursive: true });
fs.writeFileSync('video/data/real.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ signals: reference.signals.matched, cities: Object.keys(reference.signals.cities).length, cause: reference.cause.group, rr: Math.round(reference.cause.rr), coverage: reference.cause.coverage, plan: reference.plan, sqlQueries: reference.sqlQueries, exhibits: reference.exhibits, bolt: { alert: bolt.alert, recall: bolt.recall, leadDays: bolt.leadDays, quarters, followUp: bolt.followUp.map((f) => [f.campaign, f.verdict, f.before, f.after, f.p]), quotes: bolt.quotes.map((q) => [q.odi, q.filed, (q.text ?? '').slice(0, 60)]) }, backblaze: { drives: backblaze.drives, failures: backblaze.failures, worst: backblaze.worstModel, worstCounts: backblaze.worst, sac2: backblaze.worstInSac2, elsewhere: backblaze.worstElsewhere, othersSac2: backblaze.othersInSac2, othersElsewhere: backblaze.othersElsewhere, gate: backblaze.gatePass } }, null, 1));
process.exit(0);
