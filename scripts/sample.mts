// Sample mode: judge Traceon from a clean setup with no keys, no accounts and
// no network. Runs the real engine end to end and writes every output to
// sample-output/. Exits non-zero if any result differs from what it should be.
// Usage: ./sample.sh   (or, after npm install: npm run sample)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Ignore every key and account: sample mode must not depend on live services.
for (const k of Object.keys(process.env)) if (/^(NVIDIA_|NEMOTRON_|NIGHTSHIFT_|ZETARIS_|BRIGHTDATA_|OPENFDA_|AI_PROVIDER)/.test(k)) delete process.env[k];
process.env.METERLESS_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-sample-'));
process.env.NEMOTRON_CACHE = 'off';
globalThis.fetch = (async () => {
  throw new Error('sample mode is offline');
}) as typeof fetch;

const { runInvestigation } = await import('../src/lib/investigation.ts');
const { buildCaseView } = await import('../src/lib/caseView.ts');
const { verifyLedger } = await import('../src/lib/actions.ts');
const { eightD, supplierPacket } = await import('../src/lib/reports.ts');
const { simulateFollowUp } = await import('../src/lib/followup.ts');
const { analyze, loadSnapshot, recallFollowUp } = await import('../src/lib/realRecall.ts');
const { parseCsv, saveDataset } = await import('../src/lib/datasets.ts');

const OUT = path.join(process.cwd(), 'sample-output');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const failures: string[] = [];
const expect = (ok: boolean, what: string) => (ok ? null : failures.push(what));
const run = async (scenarioId: string) => {
  const events: any[] = [];
  await runInvestigation((e) => events.push(e), { scenarioId, pacingMs: 0, vision: null });
  return events;
};
const one = (ev: any[], t: string) => ev.filter((e) => e.type === t).at(-1);
const fmt = (xs: { column: string; group: string }[]) => (xs.length ? xs.map((x) => `${x.column.replace(/^f_/, '')}=${x.group}`).join(' + ') : 'none');
const lines: string[] = ['# Traceon sample run', '', `Run ${new Date().toISOString()}: offline, no keys, no network. Model steps use labelled templates; every statistic, verdict and proof is computed exactly as in live mode.`, ''];
const say = (s = '') => (console.log(s), lines.push(s));

// 1. The reference case, end to end.
say('## 1. Reference case: 125 thermal claims, seven suspects');
let t = Date.now();
const ref = await run('reference');
const view = buildCaseView(ref);
const gate = one(ref, 'gate');
const plan = one(ref, 'action').plan;
const cause = plan.causes[0];
const verified = await verifyLedger(view.evidence, 'reference');
say(`- Verdict: **${cause.column} = ${cause.group}**, relative risk ${cause.rr.rr.toFixed(0)}x, explains ${(cause.coverage * 100).toFixed(1)}% of incidents`);
say(`- Ruled out as confounders: ${view.hypotheses.filter((h) => h.status === 'CONFOUNDED').map((h) => h.title).join(', ')}`);
say(`- Evidence gate: ${gate.pass ? 'PASSED' : 'BLOCKED'} (${gate.criteria.filter((c: any) => c.pass).length}/${gate.criteria.length} criteria)`);
say(`- Action: hold ${plan.affectedUnits.toLocaleString('en-US')} units instead of recalling ${plan.blanketUnits.toLocaleString('en-US')}, saving $${plan.savingsUsd.toLocaleString('en-US')}`);
say(`- Proof: ${view.evidence.length} exhibits; replayed ${verified.replayedQueries} SQL queries, root ${verified.ok && verified.root === view.ledger!.root ? 'matches' : 'DOES NOT MATCH'} (${view.ledger!.root.slice(0, 16)}…)`);
say(`- ${((Date.now() - t) / 1000).toFixed(1)} s`);
expect(cause.group === 'CB-B-0917' && gate.pass && plan.affectedUnits === 1380 && plan.savingsUsd === 4465500, 'reference verdict');
expect(verified.ok && verified.root === view.ledger!.root, 'reference proof replay');
const dir = path.join(OUT, 'reference');
fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'events.ndjson'), ref.map((e) => JSON.stringify(e)).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'proof-bundle.json'), JSON.stringify({ scenario: 'reference', ledgerRoot: view.ledger!.root, evidence: view.evidence }, null, 1));
fs.writeFileSync(path.join(dir, 'verify.json'), JSON.stringify(verified, null, 1));
fs.writeFileSync(path.join(dir, '8d-report.html'), eightD(view));
fs.writeFileSync(path.join(dir, 'supplier-claim.html'), supplierPacket(view));
fs.writeFileSync(path.join(dir, 'explanation.txt'), one(ref, 'narrative').text + '\n');
say(`- Outputs: sample-output/reference/ (event log, proof bundle, replay result, explanation, 8D report, supplier claim)`);

// 2. Verify the fix.
const planned = simulateFollowUp(view, 'planned');
const wrong = simulateFollowUp(view, 'wrong-fix');
say('');
say('## 2. Verify the fix (simulated 30 days)');
say(`- Planned quarantine: ${planned.verdict === 'verified' ? 'fix verified, case closed' : 'REOPENED'}`);
say(`- Acting on the ${wrong.applied[0].column.replace('_', ' ')} confounder instead: ${wrong.verdict === 'reopen' ? 'fix failed, case reopened' : 'VERIFIED (unexpected)'}`);
expect(planned.verdict === 'verified' && wrong.verdict === 'reopen', 'follow-up');

// 3. Blind scenarios: the planted cause is hidden from the agent.
say('');
say('## 3. Blind scenarios (planted cause hidden until the verdict)');
say('| Scenario | Planted | Found | Gate | Result |');
say('| --- | --- | --- | --- | --- |');
for (const id of ['firmware', 'two-causes', 'noise', 'random-77', 'random-4242']) {
  const ev = await run(id);
  const rv = one(ev, 'reveal').data;
  say(`| ${id} | ${fmt(rv.truth)} | ${fmt(rv.found)} | ${rv.gateBlocked ? 'blocked' : 'allowed'} | ${rv.outcome} |`);
  expect(rv.outcome === 'correct', `blind scenario ${id}`);
}

// 4. Your data: an uploaded CSV through the same agent.
say('');
say('## 4. Uploaded CSV, generated (12,000 chargers, public/samples/charger-returns.csv)');
const table = parseCsv(fs.readFileSync('public/samples/charger-returns.csv', 'utf-8'));
const ds = saveDataset('Charger returns (sample)', table[0], table.slice(1), { outcome: 'returned', failValues: ['yes'], factors: ['resin_lot', 'mold_cavity', 'shift', 'line', 'region'], serial: 'serial', date: 'failure_date', symptom: 'symptom', daysInField: 'days_in_field' });
const up = await run(ds.id);
const upCauses = one(up, 'action')?.plan.causes ?? [];
const shift = up.filter((e) => e.type === 'hypothesis').map((e) => e.node).filter((n) => n.id === 'H-SHIFT').at(-1);
say(`- Verdict: ${fmt(upCauses)}; night shift: ${shift?.status === 'CONFOUNDED' ? 'ruled out as a confounder' : shift?.status}; gate ${one(up, 'gate').pass ? 'PASSED' : 'BLOCKED'}`);
expect(upCauses.length === 1 && upCauses[0].group === 'R-2207' && shift?.status === 'CONFOUNDED', 'uploaded CSV');

// 5. Real data: every drive in Backblaze's fleet for Q2 2026 (public Drive Stats).
say('');
say('## 5. Real uploaded data: Backblaze hard drives, Q2 2026 (355,689 drives)');
const bbTable = parseCsv(fs.readFileSync('public/samples/backblaze-drives-q2-2026.csv', 'utf-8'));
const bb = saveDataset('Backblaze Q2 2026', bbTable[0], bbTable.slice(1), { outcome: 'failed', failValues: ['yes'], factors: ['model', 'datacenter', 'age_band'], serial: 'serial', date: 'failure_date', daysInField: 'days_in_field' });
const bbEv = await run(bb.id);
const bbNodes = new Map<string, any>();
for (const e of bbEv.filter((x) => x.type === 'hypothesis')) bbNodes.set(e.node.id, e.node);
const model = bbNodes.get('H-MODEL');
say(`- Worst model: ${model?.hotGroup} (${model?.rawTest?.pLabel}); gate ${one(bbEv, 'gate').pass ? 'PASSED' : 'BLOCKED'}`);
for (const n of bbNodes.values()) say(`- ${n.title}: ${n.verdict}`);
say('- Reading: the failures sit where that model and data centre sac2 overlap, a cohort, so no fleet-wide action on either is justified.');
expect(model?.hotGroup === 'HGST HUH721212ALN604' && !one(bbEv, 'gate').pass, 'Backblaze real data');

// 6. Real data: public NHTSA complaints (snapshot in data/nhtsa/).
say('');
say('## 6. Real recalls: public NHTSA complaint histories');
say('| Vehicle | Signal fired | Fire recall | Result |');
say('| --- | --- | --- | --- |');
for (const id of ['bolt-ev', 'kia-sorento', 'hyundai-santa-fe', 'hyundai-kona-electric', 'ford-escape']) {
  const bt = analyze(loadSnapshot(id)!);
  const h = bt.headline;
  say(`| ${bt.vehicle} | ${h?.alert ? `${h.alert.date} (${h.component})` : 'never'} | ${h?.recall ? `${h.recall.date} ${h.recall.campaign}` : 'none'} | ${h?.verdict === 'early' ? `${h.leadDays} days early` : h?.verdict ?? 'no signal'} |`);
  if (id === 'bolt-ev') expect(h?.verdict === 'early' && h.leadDays === 14, 'Bolt EV backtest');
}
say('');
say('After the recall (real complaints; year before vs the year from 90 days after):');
{
  const snap = loadSnapshot('bolt-ev')!;
  const fu = recallFollowUp(snap, analyze(snap));
  for (const f of fu) say(`- Bolt EV ${f.campaign} (${f.date}): ${f.verdict === 'held' ? 'fix held' : f.verdict === 'did-not-hold' ? 'did not hold' : 'too few to tell'}. ${f.reason}`);
  expect(fu.map((f) => f.verdict).join() === 'did-not-hold,held', 'Bolt EV follow-up');
}

say('');
say(failures.length ? `## FAILED: ${failures.join(', ')}` : '## All checks passed.');
say('');
say('Open the reports in sample-output/reference/ in a browser. To use the full app in the same offline mode: ./sample.sh --serve, then http://localhost:3000');
fs.writeFileSync(path.join(OUT, 'SUMMARY.md'), lines.join('\n') + '\n');
process.exit(failures.length ? 1 : 0);
