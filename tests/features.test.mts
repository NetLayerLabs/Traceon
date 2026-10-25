// The features built on a finished case: real-recall backtest, uploaded
// data, watch mode, counterfactuals, falsifiers, verification after the fix,
// the signed stamp, reviewer cases, "ask the case", reports and the scoreboard.
// Offline throughout: no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { collect, isolatedStorage, offline } from './helpers.mts';

isolatedStorage('features');
offline();
delete process.env.NVIDIA_API_KEY;
delete process.env.ZETARIS_API_URL;
delete process.env.TRACEON_SIGNING_KEY;

const { runInvestigation } = await import('../src/lib/investigation.ts');
const { buildCaseView } = await import('../src/lib/caseView.ts');
const { analyze, loadSnapshot } = await import('../src/lib/realRecall.ts');
const { parseCsv, saveDataset, validateMapping } = await import('../src/lib/datasets.ts');
const { watchReplay } = await import('../src/lib/watch.ts');
const { counterfactualInputs } = await import('../src/lib/counterfactual.ts');
const { simulateFollowUp } = await import('../src/lib/followup.ts');
const { stampRoot, verifySignature, statementFor } = await import('../src/lib/stamp.ts');
const { saveCase, getCase, addComment, listComments } = await import('../src/lib/cases.ts');
const { askCase, caseFacts } = await import('../src/lib/ask.ts');
const { eightD, supplierPacket } = await import('../src/lib/reports.ts');
const { recordScore, summarizeScoreboard } = await import('../src/lib/scoreboard.ts');

const reference = await collect((emit) => runInvestigation(emit, { scenarioId: 'reference', pacingMs: 0 }));
const view = buildCaseView(reference.events);

test('real-recall backtest: Bolt EV fire signal fires 14 days before recall 20V701000', () => {
  const bt = analyze(loadSnapshot('bolt-ev')!);
  assert.equal(bt.headline?.component, 'ELECTRICAL');
  assert.equal(bt.headline?.alert?.date, '2020-10-30');
  assert.equal(bt.headline?.recall?.campaign, '20V701000');
  assert.equal(bt.headline?.verdict, 'early');
  assert.equal(bt.headline?.leadDays, 14);
  assert.equal(bt.firesBeforeAlert.length, 3);
  // A recall that predates every signal is reported as late, not early.
  assert.equal(analyze(loadSnapshot('ford-escape')!).headline?.verdict, 'late');
});

test('uploaded CSV: finds the defective resin lot and rules out the shift confounder', async () => {
  const table = parseCsv(fs.readFileSync('public/samples/charger-returns.csv', 'utf-8'));
  const [columns, rows] = [table[0], table.slice(1)];
  const mapping = { outcome: 'returned', failValues: ['yes'], factors: ['resin_lot', 'mold_cavity', 'shift', 'line', 'region'], serial: 'serial', date: 'failure_date', symptom: 'symptom', daysInField: 'days_in_field' };
  assert.equal(validateMapping(columns, rows, mapping), null);
  assert.match(validateMapping(columns, rows, { ...mapping, failValues: ['never'] }) ?? '', /at least 3 failed/);
  const ds = saveDataset('Chargers', columns, rows, mapping);
  const r = await collect((emit) => runInvestigation(emit, { scenarioId: ds.id, pacingMs: 0 }));
  assert.equal(r.one('gate').pass, true);
  assert.deepEqual(r.one('action').plan.causes.map((c: any) => `${c.column}=${c.group}`), ['f_resin_lot=R-2207']);
  const shift = r.of('hypothesis').map((e) => e.node).filter((n: any) => n.id === 'H-SHIFT').at(-1);
  assert.equal(shift.status, 'CONFOUNDED');
  assert.equal(r.one('reveal'), undefined, 'uploaded data has no known truth to reveal');
});

test('parseCsv handles quotes, escaped quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('watch mode alerts on the batch, and that day’s case confirms it; noise never alerts', async () => {
  const w = watchReplay('reference');
  assert.equal(w.alert?.id, 'H-BATCH');
  assert.equal(w.alert?.caseId, `reference@${w.alert?.date}`);
  assert.equal(watchReplay('noise').alert, null);
  const atAlert = await collect((emit) => runInvestigation(emit, { scenarioId: w.alert!.caseId, pacingMs: 0 }));
  assert.equal(atAlert.one('gate').pass, true);
  assert.equal(atAlert.one('reveal').data.outcome, 'correct');
});

test('as-of cutoff: a cause whose units had not shipped is not part of the truth', async () => {
  const r = await collect((emit) => runInvestigation(emit, { scenarioId: 'two-causes@2026-09-14', pacingMs: 0 }));
  const rv = r.one('reveal').data;
  assert.deepEqual(rv.truth.map((t: any) => t.column), ['firmware']);
  assert.notEqual(rv.outcome, 'wrong');
});

test('falsifiers and intervals are attached to every confirmed cause', () => {
  const c = view.action!.causes[0];
  assert.deepEqual(c.falsifiers.map((f) => f.id).sort(), ['baseline', 'residual', 'signature', 'subgroups']);
  const base = c.falsifiers.find((f) => f.id === 'baseline')!;
  assert.ok(base.current! < base.threshold!, 'the baseline is currently below its limit');
  assert.ok(c.rateCI.lo < c.ratePer10k && c.ratePer10k < c.rateCI.hi);
  const p = view.action!.projectedRange;
  assert.ok(p.lo <= view.action!.projectedIncidents30d && view.action!.projectedIncidents30d <= p.hi);
  assert.ok(view.forest.length >= 5);
});

test('counterfactual inputs carry the tested table and claim dates of the cause', () => {
  const cf = counterfactualInputs(view)!;
  const cause = cf.causes[0];
  assert.equal(cause.group, 'CB-B-0917');
  assert.equal(cause.groups.reduce((a, g) => a + g.failures, 0), 125);
  assert.equal(cause.claimsByDay.reduce((a, d) => a + d.claims, 0), cause.failures);
  assert.equal(cf.alpha, 0.01 / 7);
});

test('verification after the fix: the planned fix holds, acting on the confounder reopens the case', () => {
  const planned = simulateFollowUp(view, 'planned');
  assert.equal(planned.verdict, 'verified');
  const wrong = simulateFollowUp(view, 'wrong-fix');
  assert.equal(wrong.verdict, 'reopen');
  assert.equal(wrong.applied[0].column, 'climate_zone');
  assert.match(wrong.checks.find((c) => c.id === 'residual')!.detail, /CB-B-0917/);
  assert.deepEqual(simulateFollowUp(view, 'planned'), planned, 'seeded from the proof root, so repeatable');
});

test('signed stamp: signature verifies, tampering fails, calendars down means signature only', async () => {
  const root = view.ledger!.root;
  const s = await stampRoot(root, 'reference', view.ledger!.count);
  assert.equal(s.ots, null);
  assert.match(s.otsError ?? '', /network disabled/);
  assert.equal(s.statementSha256, crypto.createHash('sha256').update(s.statement).digest('hex'));
  assert.equal(verifySignature(s.statement, s.signature, s.key.pem), true);
  assert.equal(verifySignature(statementFor('0'.repeat(64), s.signedAt, 'reference', 1), s.signature, s.key.pem), false);
  await assert.rejects(stampRoot('not-a-root', 'reference', 1));
});

test('reviewer cases: stable id, read-only events, comments pinned to exhibits', () => {
  const c = saveCase(reference.events);
  assert.match(c.id, /^case-[a-f0-9]{16}$/);
  assert.equal(saveCase(reference.events).id, c.id, 'sharing twice gives the same link');
  assert.equal(getCase(c.id)!.events.length, reference.events.length);
  addComment(c.id, { exhibitId: 'E-14', author: 'Reviewer', text: 'Checked.' });
  addComment(c.id, { exhibitId: 'bogus', author: 'Reviewer', text: 'On the case.' });
  const all = listComments(c.id);
  assert.deepEqual(all.map((x) => x.exhibitId), ['E-14', null]);
  assert.throws(() => addComment(c.id, { author: '', text: 'x' }));
  assert.equal(getCase('../../etc/passwd'), null);
  assert.throws(() => saveCase(reference.events.filter((e) => e.type !== 'done')));
});

test('ask the case without a model returns record facts with valid citations', async () => {
  const a = await askCase(view, 'Why is the Sun Belt heat exposure ruled out?');
  assert.equal(a.source, 'case-file');
  const ids = new Set(view.evidence.map((e) => e.id));
  assert.ok(a.citations.length > 0 && a.citations.every((c) => ids.has(c)));
  assert.deepEqual(a.guard.unverified, []);
  // Each adjustment is its own fact, citing the exhibit of that exact test.
  const heatBatch = caseFacts(view).find((f) => /Sun Belt.*holding cell_batch/.test(f.text))!;
  assert.equal(view.evidence.find((e) => e.id === heatBatch.cite)?.label, 'H-HEAT | H-BATCH');
});

test('reports: 8D and supplier packet cite real exhibits and the proof root', () => {
  const ids = new Set(view.evidence.map((e) => e.id));
  for (const html of [eightD(view), supplierPacket(view)]) {
    const cites = [...html.matchAll(/\[(E-\d+)\]/g)].map((m) => m[1]);
    assert.ok(cites.length >= 5);
    assert.ok(cites.every((c) => ids.has(c)));
    assert.ok(html.includes(view.ledger!.root));
    assert.ok(!/<script(?![^>]*>\s*<\/script>)/.test(html.replace('onclick="window.print()"', '')));
  }
  assert.match(eightD(view), /D1\. Team[\s\S]*D8\. Closure/);
  assert.match(supplierPacket(view), /Supplier B/);
});

test('scoreboard summarises model guesses against tested verdicts', () => {
  const base = { at: '', scenarioId: 'random-1', modelTop: 'H-HEAT', modelTopTitle: 'Heat', statsConfirmed: ['H-BATCH'], truthKnown: true };
  recordScore({ ...base, agreed: false, modelTopCorrect: false, statsCorrect: true });
  recordScore({ ...base, modelTop: 'H-BATCH', agreed: true, modelTopCorrect: true, statsCorrect: true });
  const s = summarizeScoreboard();
  assert.equal(s.runs, 2);
  assert.equal(s.overruled, 1);
  assert.equal(s.modelTopCorrectPct, 50);
  assert.equal(s.statsCorrectPct, 100);
});
