// Regression tests for the documents and case tools: what the 8D report and the
// supplier claim cite and say, repeated approvals, how long a finished run stays
// usable, and input checks on the case and verify routes. Offline: the only
// "model" is a local stand-in that ranks the suspects (true cause first), so
// the exhibits are not numbered in catalog order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { collect, isolatedStorage } from './helpers.mts';

isolatedStorage('fix-reports');
const ranking = ['H-BATCH', 'H-SUPPLIER', 'H-PLANT', 'H-BMS', 'H-HEAT', 'H-CARRIER', 'H-FW'].map((id) => ({ id, rationale: 'stand-in' }));
// Answers the planning call only; every other call fails, so the run uses its templates.
const model = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const planning = body.includes('Testable hypotheses');
    res.writeHead(planning ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(planning ? JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ranking, untestable: [], reasoning: 'stand-in plan' }) }, finish_reason: 'stop' }] }) : '{"error":"stand-in"}');
  });
});
await new Promise<void>((r) => model.listen(0, '127.0.0.1', r));
test.after(() => model.close());
process.env.NVIDIA_NIM_BASE_URL = `http://127.0.0.1:${(model.address() as { port: number }).port}/v1`;
process.env.AI_PROVIDER = 'nim';
process.env.NEMOTRON_CACHE = 'off';
process.env.NEMOTRON_THINKING_DEADLINE_MS = '500';
process.env.DEMO_PACING_MS = '0';
for (const k of ['NVIDIA_API_KEY', 'NIGHTSHIFT_TOKEN', 'NIGHTSHIFT_TOKEN_FILE', 'ZETARIS_API_URL', 'BRIGHTDATA_API_TOKEN']) delete process.env[k];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).startsWith('http://127.0.0.1')) return realFetch(input, init);
  throw new Error('network disabled in tests');
}) as typeof fetch;

const { runInvestigation } = await import('../src/lib/investigation.ts');
const { buildCaseView, loadEvents } = await import('../src/lib/caseView.ts');
const { eightD, supplierPacket } = await import('../src/lib/reports.ts');
const { executeRemediation } = await import('../src/lib/actions.ts');
const { addComment, saveCase } = await import('../src/lib/cases.ts');
const { parseCsv, saveDataset } = await import('../src/lib/datasets.ts');
const { authorizeRemediation, getRun, startRun } = await import('../src/lib/runRegistry.ts');
const { mirrorExec } = await import('../src/lib/zetaris.ts');
const verify = await import('../src/app/api/verify/route.ts');
const cases = await import('../src/app/api/cases/route.ts');
const comments = await import('../src/app/api/cases/[id]/comments/route.ts');

/** One investigation, planned by the stand-in model or with no model at all. */
async function run(scenarioId: string, opts: { model?: boolean; vision?: any } = {}) {
  if (opts.model) process.env.NVIDIA_API_KEY = 'nvapi-test-key';
  try {
    return await collect((emit) => runInvestigation(emit, { scenarioId, pacingMs: 0, vision: opts.vision ?? null }));
  } finally {
    delete process.env.NVIDIA_API_KEY;
  }
}
const planned = await run('reference', { model: true });
const plannedView = buildCaseView(planned.events);
const offlinePhoto = { live: false, model: 'reference analysis (offline)', physicalFailureMode: 'Thermal runaway', suspectedComponent: 'terminal connector', severityScore: 92, isManufacturingDefectLikely: true, visualEvidenceSummary: 'Every cell is carbonised.' };
const offline = await run('reference', { vision: offlinePhoto });
const offlineView = buildCaseView(offline.events);

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The exhibit a document cites right after a ruled-out suspect's verdict. */
const citedFor = (html: string, verdict: string) => html.match(new RegExp(`${reEscape(esc(verdict))} <span class="cite">\\[(E-\\d+)\\]</span>`))?.[1];
const others = (v: typeof offlineView) => v.hypotheses.filter((h) => !v.action!.causes.some((c) => c.hypothesisId === h.id));

function checkCitations(v: typeof offlineView) {
  for (const html of [eightD(v), supplierPacket(v)]) {
    for (const h of others(v)) {
      const ex = v.evidence.find((e) => e.id === citedFor(html, h.verdict!));
      assert.ok(ex, `${h.id} cites an exhibit`);
      if (h.status === 'NO_ASSOCIATION') assert.equal(ex.label, `${h.id} screen`);
      else {
        const p = h.verdict!.match(/\((p [=<] [^)]+)\)/)![1];
        assert.equal(ex.label, `${h.id} | H-BATCH`, h.id);
        assert.ok(ex.summary.endsWith(`: ${p}`), `${h.id}: "${ex.summary}" holds ${p}`);
      }
    }
  }
}

test('ruled-out suspects cite the exhibit that holds their verdict, in any plan order', () => {
  assert.equal(plannedView.plan?.source, 'nemotron');
  assert.equal(plannedView.plan?.hypotheses[0].id, 'H-BATCH');
  checkCitations(plannedView);
  checkCitations(offlineView);
  // In this plan order a suspect's last exhibit is not the test that decided it.
  assert.ok(others(plannedView).some((h) => h.status === 'CONFOUNDED' && h.evidenceIds.at(-1) !== citedFor(eightD(plannedView), h.verdict!)));
});

test('D1 credits a model only for what it did in this run', () => {
  const team = (v: typeof offlineView) => eightD(v).match(/D1\. Team[\s\S]*?<\/table>/)![0];
  assert.match(team(plannedView), /NVIDIA NIM · [^;]+ ranked the suspects; explanation from a labelled template, no model; deterministic statistics decide/);
  assert.doesNotMatch(team(offlineView), /Nemotron|NIM/);
  assert.match(team(offlineView), /suspects tested in catalog order, no model/);
});

test('D2 is stated from the record, never from the model prose', () => {
  const misstated = { ...offlineView, narrative: { ...offlineView.narrative!, source: 'nemotron' as const, via: 'NVIDIA NIM · stand-in', text: 'Coverage is 92.8% of the 180,000-unit population.' } };
  const coverage = offlineView.evidence.find((e) => e.label === 'Combined coverage')!;
  assert.match(coverage.summary, /116\/125 incidents \(92\.8%\)/);
  const d2 = eightD(misstated).match(/D2\. Problem description<\/h2>\s*<p>([\s\S]*?)<\/p>/)![1];
  assert.equal(d2, `125 thermal incidents recorded among 180,000 units in the field. 116 of them (92.8% of thermal incidents) involve cell batch CB-B-0917. <span class="cite">[${coverage.id}]</span>`);
});

test('D6 prints the residual threshold the way its rule does', () => {
  const html = eightD(offlineView);
  assert.ok(!html.includes('0.0014285714285714286'));
  assert.match(html, /p below 1\.4e-3[^<]*<\/td><td class="num">[^<]+<\/td><td class="num">1\.4e-3<\/td>/);
});

test('a blocked gate: no containment, no corrective action, no fix to validate, no supplier claim', () => {
  const blocked = { ...offlineView, gate: { pass: false, criteria: offlineView.gate!.criteria.map((c) => (c.id === 'robust' ? { ...c, pass: false } : c)) } };
  const html = eightD(blocked);
  assert.match(html, /D3\. Containment<\/h2>\s*<p>No containment: the evidence gate did not pass\.<\/p>/);
  assert.ok(!html.includes('instead of recalling all'));
  assert.match(html, /Not confirmed: the evidence gate did not pass \(failed: Effect consistent in every subgroup\)/);
  assert.match(html, /D5\. Permanent corrective actions<\/h2>\s*<p>None: the evidence gate did not pass\.<\/p>/);
  assert.match(html, /D6\. Implement and validate<\/h2>\s*<p>No fix to validate: the evidence gate did not pass\.<\/p>/);
  assert.throws(() => supplierPacket(blocked), /evidence gate did not pass/);
});

test('the supplier claim counts a photo as physical evidence only when a model read it as a defect', () => {
  assert.equal(offlineView.vision?.live, false);
  const off = supplierPacket(offlineView);
  assert.ok(!off.includes('Physical evidence') && !off.includes('Every cell is carbonised'));
  assert.match(off, /Photo analysis \(not evidence\)<\/h3><p>No model analysed the photo/);
  const live = { ...offlineView.vision!, live: true, model: 'NVIDIA NIM · stand-in' };
  assert.match(supplierPacket({ ...offlineView, vision: live }), /Physical evidence<\/h3><p>Every cell is carbonised/);
  const notDefect = supplierPacket({ ...offlineView, vision: { ...live, isManufacturingDefectLikely: false } });
  assert.ok(!notDefect.includes('Physical evidence'));
  assert.match(notDefect, /NVIDIA NIM · stand-in judged that the photo does not show a manufacturing defect/);
});

test('uploaded data: the 8D and the notices name the factor, not the internal column', async () => {
  const table = parseCsv(fs.readFileSync('public/samples/charger-returns.csv', 'utf-8'));
  const mapping = { outcome: 'returned', failValues: ['yes'], factors: ['resin_lot', 'mold_cavity', 'shift', 'line', 'region'], serial: 'serial', date: 'failure_date', symptom: 'symptom', daysInField: 'days_in_field' };
  const ds = saveDataset('Chargers', table[0], table.slice(1), mapping);
  const html = eightD(buildCaseView((await run(ds.id)).events));
  assert.match(html, /Quarantine of 669 units \(resin lot R-2207\)/);
  assert.match(html, /involve resin lot R-2207\./);
  assert.ok(!html.includes('f resin'));
  assert.ok(!/<td>f_/.test(html), 'the adjustment table uses the factor name');
  const rem = await executeRemediation({ scenario: ds.id, causes: [{ column: 'f_resin_lot', group: 'R-2207', remedy: 'QUARANTINE' }], approvedBy: 'test', ledgerRoot: 'e'.repeat(64) });
  assert.match(rem.notices.regulator, /Root cause: resin lot R-2207\n/);
});

test('approving the same cause again, from any run, reuses the hold instead of adding one', async () => {
  const causes = [{ column: 'cell_batch', group: 'CB-B-0917', remedy: 'QUARANTINE' as const }];
  const first = await executeRemediation({ scenario: 'reference', causes, approvedBy: 'judge 1', ledgerRoot: 'a'.repeat(64) });
  const second = await executeRemediation({ scenario: 'reference', causes, approvedBy: 'judge 2', ledgerRoot: 'b'.repeat(64) });
  assert.equal(first.alreadyQuarantined, false);
  assert.equal(second.alreadyQuarantined, true);
  assert.equal(second.holdId, first.holdId);
  assert.equal(second.erpHoldRowCount, 1380);
  assert.equal(second.memoryInsightId, first.memoryInsightId, 'no second memory record');
  // A wider cause holds only the stock that is not on hold yet.
  const wider = await executeRemediation({ scenario: 'reference', causes: [{ column: 'cell_supplier', group: 'Supplier B', remedy: 'QUARANTINE' }], approvedBy: 'judge 3', ledgerRoot: 'c'.repeat(64) });
  assert.equal(wider.alreadyQuarantined, false);
  const [held] = mirrorExec('reference', 'SELECT COUNT(*) AS n, COUNT(DISTINCT serial) AS serials, COUNT(DISTINCT hold_id) AS holds FROM erp_holds') as { n: number; serials: number; holds: number }[];
  assert.equal(held.n, held.serials, 'no serial is held twice');
  assert.equal(held.serials, wider.unitsHeld);
  assert.equal(held.holds, 2);
});

test('the CPSC draft keeps acronyms in the corrective action', async () => {
  const rem = await executeRemediation({ scenario: 'firmware', causes: [{ column: 'firmware', group: 'v3.4', remedy: 'OTA_ROLLBACK' }], approvedBy: 'test', ledgerRoot: 'd'.repeat(64) });
  assert.match(rem.notices.regulator, /Corrective action: OTA firmware rollback \(OTA-[0-9A-F]{8}\); consumer notification to follow\./);
});

test('comments pin only to exhibits the case holds; an unknown case is a 404', async () => {
  const c = saveCase(offline.events);
  const last = offlineView.evidence.at(-1)!.id;
  assert.equal(addComment(c.id, { exhibitId: last, author: 'Reviewer', text: 'Checked.' }).exhibitId, last);
  assert.equal(addComment(c.id, { exhibitId: 'E-999', author: 'Reviewer', text: 'No such exhibit here.' }).exhibitId, null);
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (id: string, body: unknown) => comments.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), ctx(id));
  assert.equal((await post('case-0000000000000000', { author: 'R', text: 'x' })).status, 404);
  assert.equal((await comments.GET(new Request('http://x'), ctx('case-0000000000000000'))).status, 404);
  assert.equal((await post(c.id, { author: 'R', text: 'x', role: 5 })).status, 200);
});

test('verify: malformed exhibits get a 400 with a plain message; a real bundle still verifies', async () => {
  const post = (body: unknown) => verify.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));
  const bad = await post({ evidence: [null, 5, { id: 'E-01' }] });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Each exhibit needs a string id, label and proofHash');
  assert.equal((await post({ evidence: [], scenario: 5 })).status, 400);
  const good = await (await post({ evidence: offline.one('done').evidence, scenario: 'reference' })).json();
  assert.equal(good.ok, true);
});

test('a finished run outlasts eight newer runs, and a shared run keeps working once it leaves memory', async () => {
  const settled = async (id: string) => {
    for (let i = 0; i < 800 && !getRun(id)?.settled; i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(getRun(id)?.settled, 'run settled');
  };
  const first = startRun('noise', null);
  await settled(first.id);
  for (let i = 0; i < 9; i++) await settled(startRun('noise', null).id);
  assert.ok(getRun(first.id), 'still readable after nine newer runs');

  // A run shared for review, then dropped from memory, is still found by its run id.
  const runId = crypto.randomUUID();
  const shared = saveCase(planned.events, runId);
  assert.equal(getRun(runId), undefined);
  assert.equal(loadEvents(runId)?.length, planned.events.length);
  const again = await cases.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ runId }) }));
  assert.equal((await again.json()).id, shared.id);
  // ...and can still be approved: the saved case carries the passed gate and the causes.
  const causes = plannedView.action!.causes.map(({ column, group, remedy }) => ({ column, group, remedy }));
  assert.deepEqual(authorizeRemediation(plannedView.ledger!.root, causes), { ok: true, scenarioId: 'reference' });
  assert.equal(authorizeRemediation('f'.repeat(64), causes).ok, false);
});
