// UI regressions from the end-to-end audit: layout rules that keep the case
// file inside the viewport, and what the components say on uploaded data,
// blocked gates, model-chosen checks and fallbacks. Components are rendered to
// static markup from a real offline investigation; no browser, model or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { collect, isolatedStorage, offline } from './helpers.mts';

isolatedStorage('fix-ui');
offline();
delete process.env.NVIDIA_API_KEY;
delete process.env.ZETARIS_API_URL;
// The components use the automatic JSX runtime under Next; tsx compiles them with React.createElement.
(globalThis as any).React = React;

const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
const { runInvestigation } = await import('../src/lib/investigation.ts');
const { foldEvents } = await import('../src/components/state.ts');
const { SignalPane, boxLabel } = await import('../src/components/SignalPane.tsx');
const { CausalDag } = await import('../src/components/CausalDag.tsx');
const { ActionPane } = await import('../src/components/ActionPane.tsx');
const { EvidenceModal } = await import('../src/components/EvidenceModal.tsx');
const { AgentLog, Narrative, RedTeam, TimeMachine } = await import('../src/components/Insights.tsx');
const WatchPage = (await import('../src/app/watch/page.tsx')).default;
const ScoreboardPage = (await import('../src/app/scoreboard/page.tsx')).default;

const h = React.createElement;
const html = (el: React.ReactElement) => renderToStaticMarkup(h(PathnameContext.Provider, { value: '/app' }, el));
const reference = await collect((emit) => runInvestigation(emit, { scenarioId: 'reference', pacingMs: 0 }));
const fresh = () => foldEvents(structuredClone(reference.events), 'run-1');
const signalPane = (state: any, extra: Record<string, unknown> = {}) =>
  html(h(SignalPane, { feeds: [], state, photo: '/samples/ntsb-787-li-ion-battery.jpg', vision: null, visionBusy: false, onPhoto: () => {}, onAnalyze: () => {}, ...extra }));

const globals = fs.readFileSync('src/app/globals.css', 'utf8');
const landing = fs.readFileSync('src/app/landing.css', 'utf8');

test('top bar: the shell column is the viewport, and chips are dots below 1,700px (ui#1)', () => {
  assert.match(globals, /\.shell\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'a crowded top bar must not widen the panes');
  const dots = globals.match(/@media \(min-width: 1181px\) and \(max-width: (\d+)px\)\s*{\s*\.topbar \.chip::after\s*{\s*content:\s*none/);
  assert.ok(dots && Number(dots[1]) >= 1699, 'labelled chips need about 1,610px, so 1,440 and 1,600 must show dots');
  assert.match(globals, /\.topbar \.scenario-pick, \.topbar \.scenario-pick select\s*{\s*min-width:\s*0/, 'the scenario menu narrows before the Run button is pushed out');
});

test('investigation grid: equal columns, and long provider tags wrap (ui#2)', () => {
  assert.match(globals, /\.grid2\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(globals, /\.card h3 \.tag, \.qa-meta \.tag\s*{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
});

test('feed rows leave room for the widest status chip (ui#16)', () => {
  const cols = [...globals.matchAll(/\.feed-row\s*{[^}]*grid-template-columns:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(cols.length > 0 && cols.every((w) => w >= 106), `"UNREACHABLE" needs 106px, got ${cols}`);
});

test('phones: the window scrolls on app pages, and landing tables fit (ui#17, ui#14, ui#24)', () => {
  assert.match(globals, /html, body\s*{\s*overflow-x:\s*hidden;\s*overflow-x:\s*clip;/);
  // The phone rule must come after the 900px rule that sets the 520px minimum, or it never applies.
  const min520 = landing.indexOf('.lp-table:has(th:nth-child(3)) { min-width: 520px; }');
  const min0 = landing.indexOf('.lp-table:has(th:nth-child(3)) { min-width: 0; }');
  assert.ok(min520 > 0 && min0 > min520);
  assert.match(landing, /\.lp-fig b\s*{[^}]*white-space:\s*nowrap/, '"250 / 250" stays on one line');
  assert.match(globals, /\.sample-row \.btn\s*{[^}]*display:\s*inline-flex;\s*align-items:\s*center/);
});

test('photo card: no stale illustration note; box label cut at a word; fallback is labelled (ui#11, ui#22, local-core#11)', () => {
  const state = fresh();
  const vision = { live: true, model: 'NVIDIA NIM · nemotron-3.5-super-vl-120b-a12b', fallbackFrom: 'Meterless Nightshift: HTTP 400', physicalFailureMode: 'Thermal runaway', suspectedComponent: 'Internal cylindrical lithium-ion cell stack / busbar', severityScore: 90, isManufacturingDefectLikely: true, visualEvidenceSummary: 'Charred cells.', bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };
  const out = signalPane(state, { vision });
  assert.doesNotMatch(out, /illustration/i);
  assert.match(out, /real NTSB evidence photo/);
  assert.match(out, /nemotron-3\.5-super-vl-120b-a12b · fallback/);
  assert.match(out, /title="Fallback: Meterless Nightshift: HTTP 400"/);
  assert.match(out, /<span title="Internal cylindrical lithium-ion cell stack \/ busbar">Internal cylindrical…<\/span>/);
  assert.equal(boxLabel('cell 4 (center cylindrical cell)'), 'cell 4');
  assert.equal(boxLabel('Battery pack'), 'Battery pack');
  assert.equal(boxLabel('Supercalifragilisticexpialidocious-cell-module'), 'Supercalifragilisticexpialid…');
  // The upload stays keyboard-reachable: a visually hidden input, not a display:none one.
  assert.match(out, /<input type="file" accept="image\/\*" class="visually-hidden"/);
});

test('intake: the recalled finding wraps, and simulated posts are marked one by one (ui#10, local-data#16)', () => {
  const state = fresh();
  state.convergence = { ...state.convergence!, priorInsights: [{ id: 'm1', content: 'Root cause confirmed for VR-48 thermal incidents: cell_batch CB-B-0917 (Surgical quarantine).', learnedAt: '2026-10-26' }] };
  const feeds = [
    { feed: 'Web reviews & forums (VoltRide)', status: 'simulated', note: 'fictional', items: [{ id: 'BD-001', source: 'Reddit r/ebikes', date: '2026-10-10', title: 'Pack got hot', detail: '', tags: [], kind: 'web' }] },
    { feed: 'NHTSA ODI', status: 'live', note: 'real', items: [{ id: 'N-1', source: 'NHTSA ODI', date: '2026-10-09', title: 'Battery fire', detail: '', tags: [], kind: 'federal' }] },
  ];
  const out = signalPane(state, { feeds });
  assert.match(out, /white-space:normal;overflow-wrap:anywhere">Recalled from a previous session/);
  assert.match(out, /<b>Reddit r\/ebikes<\/b><span class="warn">simulated<\/span>/);
  assert.doesNotMatch(out, /<b>NHTSA ODI<\/b><span class="warn">simulated/);
});

test('uploaded data: no VR-48 signature, no "0 cities", channels counted right (ui#13)', () => {
  const state = fresh();
  state.scenario = { id: 'custom-0123456789ab', label: 'Chargers', blurb: null };
  state.convergence = { ...state.convergence!, cities: {}, channels: { warranty: 63 } };
  const intake = signalPane(state);
  assert.doesNotMatch(intake, /connector · scorch/);
  assert.match(intake, /across 1 channel\./);
  const dag = html(h(CausalDag, { state, onSelect: () => {} }));
  assert.doesNotMatch(dag, /0 cities/);
  assert.match(dag, />1 channel · /);
  // The reference case keeps its signature and plural counts.
  assert.match(signalPane(fresh()), /“connector · scorch · overheat · smoke”<\/span> seen from .* across 3 channels\./);
});

test('proof graph: every suspect fits the canvas, and every node is a keyboard button (ui#9, ui#21)', () => {
  const state = fresh();
  const ruledOut = state.hypotheses.find((x: any) => x.status === 'NO_ASSOCIATION')!;
  for (const n of [7, 9, 12]) {
    const s = fresh();
    s.hypotheses = Array.from({ length: n }, (_, i) => (i < state.hypotheses.length ? state.hypotheses[i] : { ...ruledOut, id: `H-X${i}`, title: `Extra factor ${i}` }));
    const out = html(h(CausalDag, { state: s, onSelect: () => {} }));
    const width = Number(out.match(/viewBox="0 0 (\d+(?:\.\d+)?) 486"/)![1]);
    const xs = [...out.matchAll(/<rect class="box [^"]*"(?: fill="[^"]*")? x="(-?[\d.]+)" y="152" width="122"/g)].map((m) => Number(m[1]));
    assert.equal(xs.length, n);
    assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) + 122 <= width, `${n} suspects inside a ${width}-wide canvas`);
    if (n <= 7) assert.equal(width, 960);
  }
  const out = html(h(CausalDag, { state, onSelect: () => {} }));
  assert.match(out, /<svg viewBox="[^"]*" role="group" aria-label="Causal proof graph"/);
  assert.equal([...out.matchAll(/<g class="dag-node[^"]*" role="button" tabindex="0" aria-label="[^"]+"/g)].length, state.hypotheses.length + 3);
  assert.match(out, /aria-label="Evidence gate: action allowed"/);
});

test('exhibit dialog is named by its title (ui#21)', () => {
  const out = html(h(EvidenceModal, { title: 'E-01 · Raw screen', evidence: [], onClose: () => {} }));
  const id = out.match(/role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/)![1];
  assert.match(out, new RegExp(`<h2 id="${id}">E-01 · Raw screen</h2>`));
});

test('blocked gate: the cost card proposes no remedy and claims no savings (local-data#4)', () => {
  const allowed = html(h(ActionPane, { state: fresh() }));
  assert.match(allowed, /Saved/);
  assert.match(allowed, /Traceon remedy/);
  const state = fresh();
  state.gate = { ...state.gate!, pass: false, criteria: state.gate!.criteria.map((c: any) => (c.id === 'robust' ? { ...c, pass: false } : c)) };
  const blocked = html(h(ActionPane, { state }));
  assert.doesNotMatch(blocked, /Saved|Traceon remedy|Surgical quarantine|Execute remediation/);
  assert.match(blocked, /No action/);
  assert.match(blocked, /1 of \d+ evidence-gate criteria failed, so Traceon proposes no remedy and claims no savings/);
});

test('explanation and red team: fallback and cache are labelled; a model-chosen check is not called an answer (ui#22, live-site#12, ai-providers#3)', () => {
  const state = fresh();
  state.narrative = { ...state.narrative!, source: 'nemotron', via: 'NVIDIA NIM · nemotron-3-ultra', fallbackFrom: 'Meterless Nightshift: timeout' };
  const narrative = html(h(Narrative, { state }));
  assert.match(narrative, /title="Fallback: Meterless Nightshift: timeout"/);
  assert.match(narrative, /NVIDIA NIM · nemotron-3-ultra · fallback/);

  const builtIn = html(h(RedTeam, { state: fresh() }));
  assert.match(builtIn, />ANSWERED</);
  const modelState = fresh();
  modelState.redteam = { ...modelState.redteam!, source: 'nemotron', via: 'Meterless Nightshift · lightning', cached: true } as any;
  const model = html(h(RedTeam, { state: modelState }));
  assert.match(model, /Meterless Nightshift · lightning · cached · devil’s advocate/);
  assert.match(model, />CHECK PASSED</);
  assert.doesNotMatch(model, />ANSWERED</);
});

test('replay card says why a finished run has no replay (local-data#17)', () => {
  const noDates = fresh();
  noDates.timeline = null;
  assert.match(html(h(TimeMachine, { state: noDates })), /No replay for this run: this data has no usable failure dates \(YYYY-MM-DD\)\./);
  const noCause = fresh();
  noCause.timeline = null;
  noCause.action = null;
  assert.match(html(h(TimeMachine, { state: noCause })), /No replay for this run: no cause was confirmed\./);
  const running = fresh();
  running.timeline = null;
  running.doneMs = null;
  assert.match(html(h(TimeMachine, { state: running })), /Replays the claim history day by day/);
});

test('plan: a tested hypothesis id is never listed as not testable (local-data#7)', () => {
  const state = fresh();
  const tested = state.hypotheses[0].id;
  state.plan = { ...state.plan!, untestable: [tested, 'Customer charging habits (no charger telemetry)'] };
  const out = html(h(AgentLog, { state }));
  assert.match(out, /Not testable with this data \(logged as open questions\): Customer charging habits \(no charger telemetry\)</);
  assert.doesNotMatch(out, new RegExp(`open questions\\): ${tested}`));
});

test('watch page states the 5-failure minimum; scoreboard dates the benchmark run (ui#19, docs-claims#18)', () => {
  assert.match(html(h(WatchPage)), /waits until the strongest group has at least 5 failures/);
  assert.match(html(h(ScoreboardPage)), /run on 2026-10-27 at commit f321d67/);
});
