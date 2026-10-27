// Regression tests for the engine fixes from the end-to-end audit: figures
// keep the quantity they measure, a blocked gate recommends and prices
// nothing, uploaded data is priced from its own causes, nested suspects are
// never scored with another group's numbers, open questions are not counted
// as answered, and only a live photo reading counts. A local stub stands in
// for the model, so nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { collect, isolatedStorage } from './helpers.mts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
isolatedStorage('fix-engine');
// The reply cache lives in the working directory: keep it out of the repo.
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-fix-engine-cwd-')));
process.env.AI_PROVIDER = 'nim';
process.env.NEMOTRON_CACHE = 'off';
process.env.NEMOTRON_THINKING_DEADLINE_MS = '2000';
process.env.NIGHTSHIFT_URL = 'http://127.0.0.1:9/v1'; // nothing listens on port 9: Nightshift is always down here
for (const k of ['NVIDIA_API_KEY', 'NIGHTSHIFT_TOKEN', 'NIGHTSHIFT_TOKEN_FILE', 'ZETARIS_API_URL', 'BRIGHTDATA_API_TOKEN', 'TRACEON_SIGNING_KEY']) delete process.env[k];

// The stub model answers each job with the reply the current test sets.
const replies = { plan: 'not json', redteam: 'not json', explain: '' };
const prompts = { plan: '' };
const stub = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const system = String(body.messages.find((m: { role: string }) => m.role === 'system')?.content ?? '');
  const job = /planning module/.test(system) ? 'plan' : /red-teaming/.test(system) ? 'redteam' : 'explain';
  if (job === 'plan') prompts.plan = String(body.messages.at(-1).content);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: replies[job] }, finish_reason: 'stop' }] }));
});
await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
process.env.NVIDIA_NIM_BASE_URL = `http://127.0.0.1:${(stub.address() as { port: number }).port}/v1`;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).startsWith('http://127.0.0.1')) return realFetch(input, init);
  throw new Error('network disabled in tests');
}) as typeof fetch;
test.after(() => stub.close());

/** Runs with the stub configured as NVIDIA NIM; every other test runs with no model at all. */
async function withModel<T>(set: Partial<typeof replies>, fn: () => Promise<T>): Promise<T> {
  Object.assign(replies, { plan: 'not json', redteam: 'not json', explain: '' }, set);
  process.env.NVIDIA_API_KEY = 'nvapi-test-key';
  try {
    return await fn();
  } finally {
    delete process.env.NVIDIA_API_KEY;
  }
}

const { runInvestigation, explanationProblems } = await import('../src/lib/investigation.ts');
const { parseCsv, saveDataset } = await import('../src/lib/datasets.ts');
const { buildCaseView } = await import('../src/lib/caseView.ts');
const { simulateFollowUp } = await import('../src/lib/followup.ts');
const { analyzeDefectPhoto } = await import('../src/lib/vision.ts');
const { readScoreboard } = await import('../src/lib/scoreboard.ts');

const run = (scenarioId: string, vision: unknown = null) => collect((emit) => runInvestigation(emit, { scenarioId, pacingMs: 0, vision: vision as never }));
type Run = Awaited<ReturnType<typeof run>>;
const nodes = (r: Run) => Object.fromEntries(r.of('hypothesis').map((e) => [e.node.id, e.node]));
const label = (r: Run, id?: string) => r.one('done').evidence.find((e: { id: string }) => e.id === id)?.label;
const criterion = (r: Run, id: string) => r.one('gate').criteria.find((c: { id: string }) => c.id === id);
const upload = (file: string, mapping: Record<string, unknown>) => {
  const t = parseCsv(fs.readFileSync(path.join(ROOT, 'public/samples', file), 'utf-8'));
  return saveDataset(file, t[0], t.slice(1), mapping as never).id;
};
const CHARGER = { outcome: 'returned', failValues: ['yes'], factors: ['resin_lot', 'mold_cavity', 'shift', 'line', 'region'], serial: 'serial', date: 'failure_date', symptom: 'symptom', daysInField: 'days_in_field' };

// H-BATCH ranked first: the order in which the old citation (the last adjustment run) was wrong.
const PLAN = JSON.stringify({
  ranking: ['H-BATCH', 'H-HEAT', 'H-PLANT', 'H-SUPPLIER', 'H-BMS', 'H-FW', 'H-CARRIER'].map((id) => ({ id, rationale: id === 'H-HEAT' ? 'Over 57.3% of events are in Austin, TX and Denver, CO.' : `${id} is worth testing.` })),
  untestable: ['H-FW', 'H-AGE_BAND', 'Rider weight (not recorded)'],
  reasoning: 'Over 57.3% of events are in Austin, TX and Denver, CO. Austin and Phoenix lead the signals.',
});
const REDTEAM = JSON.stringify({
  objections: [
    { objection: 'Subgroup consistency is unproven; the effect might reverse in key demographics (e.g., high-volume users).', check: 'subgroups' },
    { objection: 'The 1668x RR could be an artifact; a handful of incidents inflates the rate.', check: 'granularity' },
    { objection: 'Hot climates could be cooking these packs instead.', check: 'confounding' },
    { objection: 'Storage conditions at the retailer could explain it.', check: 'untestable' },
  ],
  reasoning: 'Two of these cannot be tested.',
});
const WRONG_SHARE = 'Traceon traced 116 thermal incidents to cell batch CB-B-0917 at Supplier B.\n\nCoverage is 92.8% of the 180,000-unit population.\n\nRecommended action: surgical quarantine of 1,380 units instead of recalling 180,000, saving $4,465,500.';
const RIGHT_SHARE = 'Traceon traced 116 thermal incidents to cell batch CB-B-0917 at Supplier B, which explains 92.8% of all thermal claims.\n\nThe other suspects looked guilty only because they share units with the batch.\n\nRecommended action: surgical quarantine of 1,380 units instead of recalling 180,000, saving $4,465,500.';

test('meaning check: the share of incidents explained is never a share of units', () => {
  const f = { shareOfIncidentsExplainedPct: 92.8 };
  assert.equal(explanationProblems('Coverage is 92.8% of the 180,000-unit population.', f, 'action').length, 1);
  assert.equal(explanationProblems('This lot covers 92.8% of the 180,000-unit population.', f, 'action').length, 1);
  assert.equal(explanationProblems('It explains 93% of the 1,380 affected units.', f, 'action').length, 1, 'rounded figures are caught too');
  assert.deepEqual(explanationProblems('Together they account for 92.8% of all thermal claims.', f, 'action'), []);
  assert.deepEqual(explanationProblems('The 1,380 units of the batch account for 92.8% of incidents.', f, 'action'), []);
  assert.deepEqual(explanationProblems('Two causes explain 95.6% of incidents across the 180,000-unit population.', { shareOfIncidentsExplainedPct: 95.6 }, 'action'), []);
  // 116 of 125 incidents explained: "every incident" is wrong, "of all thermal claims" is not.
  const some = { shareOfIncidentsExplainedPct: 92.8, incidentsExplained: 116, totalIncidents: 125 };
  assert.match(explanationProblems('A root-cause investigation traced every incident to a single defective cell batch.', some, 'action').join(), /every incident is explained, but 116 of 125 are/);
  assert.deepEqual(explanationProblems('The batch accounts for 92.8% of all thermal claims.', some, 'action'), []);
  assert.deepEqual(explanationProblems('The suspects do not explain all failures.', some, 'blocked'), []);
  assert.deepEqual(explanationProblems('The batch accounts for every incident.', { ...some, incidentsExplained: 125 }, 'action'), [], 'true when all are explained');
});

test('meaning check: a blocked gate is not argued past', () => {
  const f = { shareOfIncidentsExplainedPct: 19.8 };
  assert.match(explanationProblems('Surgical quarantine of the affected units is recommended.', f, 'blocked').join(), /recommends action/);
  assert.match(explanationProblems('Both warrant surgical quarantine.', f, 'blocked').join(), /recommends action/);
  assert.match(explanationProblems('The targeted approach saves $8,892,225.', f, 'blocked').join(), /quotes a cost/);
  assert.match(explanationProblems('Holding them costs 242350 USD.', f, 'blocked').join(), /quotes a cost/);
  assert.deepEqual(explanationProblems('No quarantine or recall is recommended until every subgroup agrees. Look closer at sac2.', f, 'blocked'), []);
  assert.deepEqual(explanationProblems('Recommendation: do not recall; a blanket recall would cost $4,500,000.', {}, 'none'), [], 'a no-cause run may name the recall it avoids');
  assert.match(explanationProblems('We recommend quarantining the sac2 drives.', {}, 'none').join(), /recommends action/);
  assert.deepEqual(explanationProblems('Surgical quarantine of the affected units is recommended, saving $4,465,500.', f, 'action'), [], 'a passed gate may recommend and price the remedy');
});

test('reference with a model: wrong share rejected, citations follow the verdict, plan figures checked, open questions not counted', async () => {
  const r = await withModel({ plan: PLAN, redteam: REDTEAM, explain: WRONG_SHARE }, () => run('reference'));
  // The explanation that put 92.8% on the population is replaced by the template, and says why.
  const n = r.one('narrative');
  assert.equal(n.source, 'template');
  assert.match(n.fallbackFrom, /reply not used: it states 92\.8% \(a share of incidents\) as a share of units/);
  assert.ok(!/population/.test(n.text));
  assert.match(n.text, /account for 92\.8% of all thermal claims/);
  assert.deepEqual(n.guard.unverified, []);

  // H-BATCH was screened first, so each confounder's last adjustment is not the one its verdict quotes.
  const ns = nodes(r);
  assert.equal(r.one('plan').hypotheses[0].id, 'H-BATCH');
  for (const id of ['H-HEAT', 'H-PLANT', 'H-BMS', 'H-SUPPLIER']) {
    assert.equal(label(r, ns[id].verdictEvidenceId), `${id} | H-BATCH`, id);
    assert.notEqual(ns[id].evidenceIds.at(-1), ns[id].verdictEvidenceId, `${id}: the old citation would have been wrong`);
  }
  for (const id of ['H-FW', 'H-CARRIER']) assert.equal(label(r, ns[id].verdictEvidenceId), `${id} screen`);

  // Plan: cities sorted by count with their climate; a sentence with a made-up figure is left out; ids are not ideas.
  assert.match(prompts.plan, /Cities by number of signals \(all \d+ signals\): .*Phoenix, AZ \d+ \(Sun Belt\)/);
  assert.match(prompts.plan, /Denver, CO \d+ \(temperate\)/);
  const counts = [...prompts.plan.matchAll(/, [A-Z]{2} (\d+) \(/g)].map((m) => Number(m[1]));
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  const plan = r.one('plan');
  assert.equal(plan.reasoning, 'Austin and Phoenix lead the signals.');
  assert.ok(!plan.hypotheses.find((h: { id: string }) => h.id === 'H-HEAT').rationale.includes('57.3'));
  assert.deepEqual(plan.untestable, ['Rider weight (not recorded)']);

  // Red team: the demographic objection is an open question, the small-count one goes to the chance check.
  const rt = r.one('redteam');
  assert.deepEqual(rt.objections.map((o: { check: string }) => o.check), ['untestable', 'chance', 'confounding', 'untestable']);
  assert.equal(criterion(r, 'redteam').pass, true, 'open questions do not block');
  assert.equal(criterion(r, 'redteam').detail, '2/2 testable objections answered with evidence; 2 open questions logged, not blocking (the data cannot test them)');
  assert.equal(r.one('done').evidence.find((e: { label: string }) => e.label === 'Red-team review').summary, '2/2 testable objections answered by evidence; 2 open questions logged');
});

test('reference with a model: an explanation that keeps the share of incidents is used', async () => {
  const r = await withModel({ explain: RIGHT_SHARE }, () => run('reference'));
  const n = r.one('narrative');
  assert.equal(n.source, 'nemotron');
  assert.equal(n.text, RIGHT_SHARE);
  assert.deepEqual(n.guard.unverified, []);
});

test('cache replays are labelled and not scored again as a new model guess', async () => {
  // The signals the planner sees settle once they are stored, so the first run only warms the store.
  await withModel({ plan: PLAN, redteam: REDTEAM, explain: RIGHT_SHARE }, () => run('firmware'));
  process.env.NEMOTRON_CACHE = 'on';
  try {
    const before = readScoreboard().length;
    const first = await withModel({ plan: PLAN, redteam: REDTEAM, explain: RIGHT_SHARE }, () => run('firmware'));
    assert.equal(first.one('plan').cached, undefined);
    assert.equal(readScoreboard().length, before + 1);
    // An offline photo leaves every prompt the same (so every reply is a replay) but changes the ledger root.
    const offlinePhoto = { live: false, model: 'reference analysis (offline)', physicalFailureMode: 'x', suspectedComponent: 'y', severityScore: 1, isManufacturingDefectLikely: true, visualEvidenceSummary: 'z' };
    const second = await withModel({ plan: PLAN, redteam: REDTEAM, explain: RIGHT_SHARE }, () => run('firmware', offlinePhoto));
    assert.notEqual(second.one('ledger').root, first.one('ledger').root);
    assert.equal(second.one('plan').cached, true);
    assert.equal(second.one('redteam').cached, true);
    assert.ok(second.of('log').some((e) => / · cached\)$/.test(e.text)), 'the trace says the plan was replayed');
    assert.equal(readScoreboard().length, before + 1, 'the replayed plan is not a second guess');
  } finally {
    process.env.NEMOTRON_CACHE = 'off';
  }
});

test('uploaded data: the plan is priced from its own quarantine, names columns as the user did, and sends no records to the model', async () => {
  const r = await run(upload('charger-returns.csv', CHARGER));
  const plan = r.one('action').plan;
  assert.deepEqual([plan.affectedUnits, plan.surgicalCostUsd, plan.savingsUsd], [669, 16_725, 283_275]);
  assert.equal(plan.surgicalCostUsd, plan.causes[0].costUsd);
  for (const n of Object.values(nodes(r)) as { verdict: string }[]) assert.ok(!/\bf_/.test(n.verdict), n.verdict);
  assert.match(nodes(r)['H-SHIFT'].verdict, /holding resin_lot fixed/);
  assert.match(nodes(r)['H-LINE'].verdict, /^Ruled out\. No significant association across line /);
  assert.deepEqual(r.one('plan').untestable, [], 'no e-bike open questions on someone else’s data');
  assert.match(r.of('phase').map((e) => e.label).join('|'), /Planning hypotheses \(no model configured/);
  const followUp = simulateFollowUp(buildCaseView(r.events), 'planned');
  assert.match(followUp.summary, /surgical quarantine of resin lot R-2207/);

  await withModel({}, () => run(upload('charger-returns.csv', CHARGER)));
  assert.match(prompts.plan, /\d+ uploaded failure records \(.+\); the records themselves are not shared/);
  assert.ok(!/CH-\d/.test(prompts.plan), 'no serial reaches the model');
});

test('two causes: affected units are the distinct union, and a weakened confounder is not said to disappear', async () => {
  const r = await run('two-causes');
  const union = r.one('done').evidence.find((e: { label: string }) => e.label === 'Combined coverage');
  assert.equal(r.one('action').plan.affectedUnits, union.query.rows[0].units);
  assert.equal(r.one('action').plan.affectedUnits, 72_783);
  assert.match(nodes(r)['H-BMS'].verdict, /holding cell_batch fixed, the effect is no longer significant after correction \(p = 0\.02\)/);
});

test('nested suspects (Backblaze preset): a drive model is never scored with another model’s numbers', async () => {
  const id = upload('backblaze-drives-q2-2026.csv', { outcome: 'failed', failValues: ['yes'], factors: ['model', 'manufacturer', 'capacity_tb', 'datacenter', 'age_band'], serial: 'serial', date: 'failure_date', daysInField: 'days_in_field' });
  const r = await run(id);
  const ns = nodes(r);
  assert.equal(r.of('action').length, 0, 'nothing is confirmed, so nothing is planned');
  // The model sits inside HGST and inside 12TB: only sac2 is excluded when measuring it.
  assert.match(ns['H-MODEL'].verdict, /^Not material on its own\. With sac2 excluded, HGST HUH721212ALN604 fails at /);
  assert.equal(label(r, ns['H-MODEL'].verdictEvidenceId), 'H-MODEL excluding other causes');
  // HGST outside its nested model: a handful of failures, an interval that includes 1.
  assert.match(ns['H-MANUFACTURER'].verdict, /RR 2\.9, but its 95% CI 0\.7-11 includes 1/);
  for (const n of Object.values(ns) as { verdict: string; status: string }[]) {
    assert.notEqual(n.status, 'CONFIRMED');
    assert.ok(!/RR 8x/.test(n.verdict));
  }
  const noise = criterion(r, 'noise');
  assert.equal(noise.pass, false, 'failures concentrated 6x in one cohort are not baseline noise');
  assert.match(noise.detail, /^Not baseline noise: /);
  assert.ok(!/baseline failures look like|Recommended action|saving/.test(r.one('narrative').text));
});

test('a blocked gate with a confirmed cause: the explanation recommends and prices nothing', async () => {
  const id = upload('charger-returns.csv', { ...CHARGER, factors: ['resin_lot'] });
  const r = await run(id);
  assert.equal(r.one('gate').pass, false);
  assert.ok(r.one('action').plan.causes.length > 0);
  const text = r.one('narrative').text;
  assert.match(text, /The evidence gate blocked action\. Not met: effect consistent in every subgroup/);
  assert.match(text, /Recommendation: no quarantine or recall yet\./);
  assert.ok(!/\$|Recommended action|saving/.test(text), text);
  assert.deepEqual(explanationProblems(text, { shareOfIncidentsExplainedPct: 53.3 }, 'blocked'), []);
  // With nothing to stratify by, the exposure objection is not answered, and says why.
  const exposure = r.one('redteam').objections.find((o: { check: string }) => o.check === 'exposure_time');
  assert.equal(exposure.survived, false);
  assert.match(exposure.result, /with no other factor to check it within, age cannot be ruled out/);
  assert.ok(!r.one('redteam').objections.some((o: { check: string }) => o.check === 'subgroups'), 'no subgroup answer without subgroups');

  const m = await withModel({ explain: 'R-2207 caused 48 failures in the chargers.\n\nSurgical quarantine of the 669 affected units is recommended.' }, () => run(id));
  assert.equal(m.one('narrative').source, 'template');
  assert.match(m.one('narrative').fallbackFrom, /recommends action although the evidence gate blocked it/);
});

test('photo: only a live reading of a manufacturing defect counts as corroboration', async () => {
  const photo = { model: 'm', physicalFailureMode: 'Melted terminal', suspectedComponent: 'Terminal connector', severityScore: 80, visualEvidenceSummary: 's' };
  const offline = await run('reference', { ...photo, live: false, isManufacturingDefectLikely: true });
  assert.match(criterion(offline, 'corroborate').detail, /photo not counted \(offline reference analysis\)$/);
  assert.ok(!/photo/.test(offline.one('narrative').text));
  const notDefect = await run('reference', { ...photo, live: true, isManufacturingDefectLikely: false });
  assert.match(criterion(notDefect, 'corroborate').detail, /photo not counted \(the model judged it not a manufacturing defect\)$/);
  assert.ok(!/photo/.test(notDefect.one('narrative').text));
  const live = await run('reference', { ...photo, live: true, isManufacturingDefectLikely: true });
  assert.match(criterion(live, 'corroborate').detail, /, photo: Terminal connector$/);
  assert.match(live.one('narrative').text, /consistent failure signature that the live photo analysis also supports/);

  const reference = await analyzeDefectPhoto('data:image/png;base64,AAAA', 'test');
  assert.equal(reference.live, false);
  assert.match(reference.visualEvidenceSummary, /^Reference description of the bundled NTSB sample photo .*; no model looked at this image\./);
});

test('photo: the finding says when another provider answered, and why', async () => {
  process.env.AI_PROVIDER = 'auto';
  process.env.NIGHTSHIFT_TOKEN = 'ns-test-token';
  try {
    const reading = { physicalFailureMode: 'Melted pin', suspectedComponent: 'Charge port pin', severityScore: 70, isManufacturingDefectLikely: true, visualEvidenceSummary: 'Pin 3 is melted.', cached: true };
    const v = await withModel({ explain: JSON.stringify(reading) }, () => analyzeDefectPhoto('data:image/png;base64,AAAA', 'test'));
    assert.equal(v.live, true);
    assert.match(v.model, /^NVIDIA NIM · /);
    assert.match(v.fallbackFrom ?? '', /^Meterless Nightshift: /);
    assert.equal(v.cached, undefined, 'only the reply cache can say a reply was replayed');
  } finally {
    process.env.AI_PROVIDER = 'nim';
    delete process.env.NIGHTSHIFT_TOKEN;
  }
});

test('baseline noise is claimed only when nothing stood out', async () => {
  const r = await run('noise');
  assert.equal(criterion(r, 'noise').pass, true);
  assert.match(criterion(r, 'noise').detail, /no structure in any factor$/);
});
