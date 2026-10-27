'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ActionPane } from '@/components/ActionPane';
import { AppNav } from '@/components/AppNav';
import { AskCase, Falsifiers, Uncertainty, WhatIf } from '@/components/CaseTools';
import { CausalDag } from '@/components/CausalDag';
import { EvidenceModal } from '@/components/EvidenceModal';
import { AgentLog, Narrative, RedTeam, RevealCard, Robustness, TimeMachine } from '@/components/Insights';
import { SignalPane } from '@/components/SignalPane';
import { renderSelection } from '@/components/Selection';
import type { DagSelection } from '@/components/Selection';
import { initialState, reducer } from '@/components/state';
import type { VisionFinding } from '@/components/state';
import type { InvestigationEvent } from '@/lib/investigation';
import { SCENARIO_OPTIONS } from '@/lib/scenarioOptions';
import type { FeedResult } from '@/lib/signals';

// A real forensic photo (NTSB, public domain) standing in for a customer's photo.
const SAMPLE_PHOTO = '/samples/ntsb-787-li-ion-battery.jpg';
const STEPS = [
  { id: 'ingest', label: 'Ingest' },
  { id: 'converge', label: 'Converge' },
  { id: 'plan', label: 'Plan' },
  { id: 'screen', label: 'Screen' },
  { id: 'adjudicate', label: 'Confounders' },
  { id: 'robustness', label: 'Robustness' },
  { id: 'scope', label: 'Scope' },
  { id: 'redteam', label: 'Red team' },
  { id: 'timeline', label: 'Replay' },
  { id: 'explain', label: 'Explain' },
];

interface Status {
  /** live: Nemotron answers on NIM, or through Nightshift (viaNightshift: the Nemotron models Nightshift serves). */
  nemotron: { live: boolean; model: string; fastModel: string; viaNightshift?: string[] };
  ai?: { providers: string[]; nightshift: { configured: boolean; state: string; url: string; standIn?: boolean } };
  zetaris: { mode: string; host: string | null; parity: { ok: boolean; probes: { sql: string; ok: boolean; error?: string }[] } | null };
  meterless: { memories: number; quarantinedLots: string[] };
  brightdata: { live: boolean };
  resetDisabled?: boolean;
}

/** Where Nemotron answers, for the chip's tooltip. */
function nemotronTitle(s: Status) {
  const lines: string[] = [];
  if (s.nemotron.viaNightshift?.length) lines.push(`Through Nightshift: ${s.nemotron.viaNightshift.join(', ')}`);
  if (s.ai?.providers.includes('nim')) lines.push(`On NVIDIA NIM: ${s.nemotron.model}, ${s.nemotron.fastModel}`);
  return lines.join('\n') || 'No Nemotron provider configured';
}

/** Nemotron VL needs a raster image; draw SVG/other images onto a canvas and export PNG. */
async function toPngDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:image/') && !src.startsWith('data:image/svg')) return src;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth || 800, img.naturalHeight || 560));
  canvas.width = Math.round((img.naturalWidth || 800) * scale);
  canvas.height = Math.round((img.naturalHeight || 560) * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** Scenario ids beyond the menu: an uploaded dataset, or any scenario as of a past date (from watch mode). */
const EXTRA_ID = /^(custom-[a-f0-9]{12}|[a-z0-9-]+@\d{4}-\d{2}-\d{2})$/;
function describeScenario(id: string) {
  const known = SCENARIO_OPTIONS.find((o) => o.id === id);
  if (known) return known;
  if (id.startsWith('custom-')) return { id, label: 'Uploaded dataset', blurb: 'Your own data: one row per unit, an outcome column and the factors to test.' };
  const [base, date] = id.split('@');
  const b = SCENARIO_OPTIONS.find((o) => o.id === base);
  return { id, label: `${b ? b.label.split(':')[0] : base} as of ${date}`, blurb: `Only the units shipped and claims filed by ${date}: what the agent could have known that day.` };
}

const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [feeds, setFeeds] = useState<FeedResult[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [photo, setPhoto] = useState(SAMPLE_PHOTO);
  const [vision, setVision] = useState<VisionFinding | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [selection, setSelection] = useState<DagSelection | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [scenarioKind, setScenarioKind] = useState('reference');
  const [seed, setSeed] = useState<number>(() => newSeed());
  const [notice, setNotice] = useState<string | null>(null);
  // Phones and tablets (<= 900px): one pane at a time plus a controls drawer.
  const [mobileTab, setMobileTab] = useState<'intake' | 'investigation' | 'disposition'>('investigation');
  const [drawer, setDrawer] = useState(false);
  const [exhibit, setExhibit] = useState<string | null>(null);
  const received = useRef(0); // events applied for the current run (for stream recovery)
  const scenarioId = scenarioKind === 'random' ? `random-${seed}` : scenarioKind;

  const loadStatus = useCallback(() => {
    fetch(`/api/status?scenario=${encodeURIComponent(scenarioId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((s: Status) => {
        setStatus(s);
        setStatusFailed(false);
      })
      .catch(() => setStatusFailed(true));
  }, [scenarioId]);

  // The signal radar follows the selected scenario.
  useEffect(() => {
    setFeeds(null);
    // A slower answer for the previous scenario must not overwrite this one.
    let current = true;
    fetch(`/api/signals?scenario=${encodeURIComponent(scenarioId)}`, { signal: AbortSignal.timeout(30_000) })
      .then((r) => r.json())
      .then((d) => current && setFeeds(d.feeds ?? []))
      .catch(() => current && setFeeds([]));
    return () => {
      current = false;
    };
  }, [scenarioId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const analyze = useCallback(async (): Promise<VisionFinding | null> => {
    setVisionBusy(true);
    try {
      const image = await toPngDataUrl(photo);
      const res = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`vision ${res.status}`);
      const v = (await res.json()) as VisionFinding;
      setVision(v);
      return v;
    } catch {
      return null;
    } finally {
      setVisionBusy(false);
    }
  }, [photo]);

  const apply = (e: InvestigationEvent) => {
    received.current++;
    dispatch({ type: 'event', event: e });
  };

  /** Catch up on a run by polling its event log (after a dropped stream, or to attach to someone else's run). */
  const follow = async (runId: string) => {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`/api/investigate?run=${runId}&from=${received.current}`, { signal: AbortSignal.timeout(10_000) });
        if (res.status === 404) throw new Error('The run is no longer available on the server');
        const data = (await res.json()) as { done: boolean; events: InvestigationEvent[] };
        data.events.forEach(apply);
        if (data.done) return;
      } catch (e) {
        if ((e as Error).message.includes('no longer available')) throw e;
      }
      await sleep(1000);
    }
    throw new Error('Lost contact with the investigation');
  };

  const run = async () => {
    setNotice(null);
    received.current = 0;
    dispatch({ type: 'start' });
    setMobileTab('investigation');
    setDrawer(false);
    setRunKey((k) => k + 1);
    // The sample photo is of the demo battery; it says nothing about uploaded data.
    const v = vision ?? (scenarioId.startsWith('custom-') && photo === SAMPLE_PHOTO ? null : await analyze());
    let runId: string | null = null;
    try {
      const res = await fetch('/api/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vision: v, scenario: scenarioId }) });
      if (res.status === 409) {
        // Someone else is investigating: attach to their run instead of failing.
        const busy = await res.json();
        setNotice(`Another investigation (${busy.scenarioId}) is already running. Showing it live.`);
        dispatch({ type: 'runId', runId: busy.runId });
        await follow(busy.runId);
        return;
      }
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      runId = res.headers.get('X-Run-Id');
      if (runId) dispatch({ type: 'runId', runId });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let sawDone = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const e = JSON.parse(line) as InvestigationEvent;
            if (e.type === 'done') sawDone = true;
            apply(e);
          }
        }
      } catch {
        // Stream dropped mid-run; recover below.
      }
      if (!sawDone && runId) {
        setNotice('Connection dropped; recovering the investigation from the server…');
        await follow(runId);
        setNotice(null);
      }
    } catch (e) {
      dispatch({ type: 'fail', message: (e as Error).message });
    }
    loadStatus();
  };

  const reset = async () => {
    // Demo memory is shared by everyone using this deployment.
    if (!window.confirm('Reset the demo? This clears demo memory and ERP holds for everyone using this deployment.')) return;
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) {
      setNotice((await res.json().catch(() => ({}))).error ?? 'Reset failed');
      return;
    }
    loadStatus();
    window.location.reload();
  };

  // ?autorun=1 starts the investigation on load (handy for demo recordings); ?scenario= preselects one.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sc = params.get('scenario');
    if (sc && (SCENARIO_OPTIONS.some((o) => o.id === sc) || EXTRA_ID.test(sc))) setScenarioKind(sc);
    if (params.has('autorun')) setTimeout(() => document.getElementById('run-btn')?.click(), 50);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const modal = selection ? renderSelection(selection, state) : null;
  const stepIdx = STEPS.findIndex((s) => s.id === state.phase);
  const started = state.running || state.doneMs !== null || state.hypotheses.length > 0;
  const option = describeScenario(scenarioKind);
  const extra = !SCENARIO_OPTIONS.some((o) => o.id === scenarioKind);
  const exhibitItem = exhibit ? state.evidence.find((e) => e.id === exhibit) : null;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" style={{ color: 'inherit', textDecoration: 'none' }} title="Back to overview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/brand/traceon-header.png" alt="Traceon" width={882} height={160} />
          <small>{scenarioKind.startsWith('custom-') ? 'Case file · uploaded data' : 'Case file · VoltRide VR-48 thermal events'}</small>
        </a>
        {/* Desktop: these controls sit in the top bar (display: contents). Phones: a left drawer. */}
        <div className={`controls ${drawer ? 'open' : ''}`} role={drawer ? 'dialog' : undefined} aria-label="Controls">
          <div className="drawer-head">
            <span>Controls</span>
            <button className="btn small" onClick={() => setDrawer(false)}>
              Close
            </button>
          </div>
          <AppNav />
          <div className="scenario-pick" title={option.blurb}>
            <span className="drawer-label">Scenario</span>
            <select
              value={scenarioKind}
              onChange={(e) => {
                setScenarioKind(e.target.value);
                setDrawer(false);
              }}
              disabled={state.running}
              aria-label="Scenario"
            >
              {extra && <option value={scenarioKind}>{option.label}</option>}
              {SCENARIO_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {scenarioKind === 'random' && (
              <button className="btn ghost small" onClick={() => setSeed(newSeed())} disabled={state.running} title="Draw a new hidden scenario">
                ↻ #{seed}
              </button>
            )}
          </div>
          <div className="chips">
            <span className="drawer-label">Integrations</span>
            {!status ? (
              // Until the status is known, no integration is shown as live, simulated or offline.
              <span className="chip" data-short={statusFailed ? 'Status unavailable' : 'Checking…'} title={statusFailed ? 'The integration status could not be loaded' : 'Checking which integrations are live'}>
                <span className="dot" />
                {statusFailed ? 'Integration status unavailable' : 'Checking integrations…'}
              </span>
            ) : (
              <>
                {status.ai?.nightshift.configured && (
                  <span className={`chip ${status.ai.nightshift.state === 'online' ? 'live' : 'sim'}`} title={`Meterless Nightshift at ${status.ai.nightshift.url}`} data-short="Nightshift">
                    <span className="dot" />
                    Nightshift {status.ai.nightshift.standIn ? 'stand-in' : status.ai.nightshift.state}
                  </span>
                )}
                <span className={`chip ${status.nemotron.live ? 'live' : 'sim'}`} title={nemotronTitle(status)} data-short="Nemotron">
                  <span className="dot" />
                  Nemotron {status.nemotron.live ? 'live' : 'offline'}
                </span>
                <span
                  className={`chip ${status.zetaris.mode === 'ZETARIS_CLOUD' && status.zetaris.parity?.ok ? 'live' : 'sim'}`}
                  data-short={status.zetaris.mode === 'ZETARIS_CLOUD' ? `Zetaris · ${status.zetaris.parity?.ok ? 'parity ok' : 'parity failed'}` : 'Zetaris local'}
                  title={status.zetaris.parity ? status.zetaris.parity.probes.map((p) => `${p.ok ? 'PASS' : 'FAIL'} ${p.sql}${p.error ? ` (${p.error})` : ''}`).join('\n') : 'Queries run on the local federated mirror'}
                >
                  <span className="dot" />
                  Zetaris {status.zetaris.mode === 'ZETARIS_CLOUD' ? `cloud · ${status.zetaris.parity?.ok ? 'parity ok' : 'parity failed'}` : 'local mirror'}
                </span>
                <span className="chip live" data-short="H-MEM" title={`Meterless H-MEM: ${status.meterless.memories} memories for this scenario`}>
                  <span className="dot" />
                  H-MEM {status.meterless.memories} memories
                </span>
                {/* Without a token there is no news feed at all; nothing from Bright Data is simulated. */}
                <span className={status.brightdata.live ? 'chip live' : 'chip'} data-short="Bright Data" title={status.brightdata.live ? 'Bright Data Web Unlocker: live news on e-bike battery fires' : 'Bright Data is not configured: no news feed'}>
                  <span className="dot" />
                  Bright Data {status.brightdata.live ? 'live' : 'off'}
                </span>
              </>
            )}
          </div>
          {status && !status.resetDisabled && (
            <button className="btn ghost small" onClick={reset} disabled={state.running} title="Clear memory and ERP holds">
              Reset demo
            </button>
          )}
          <a className="btn ghost small drawer-only" href="/">
            Overview
          </a>
        </div>
        <button className={`burger-btn ${drawer ? 'open' : ''}`} aria-expanded={drawer} aria-label="Toggle controls" onClick={() => setDrawer((d) => !d)}>
          <span />
          <span />
          <span />
        </button>
        <button id="run-btn" className="btn primary" onClick={run} disabled={state.running || visionBusy}>
          {state.running ? 'Investigating…' : started ? 'Re-run investigation' : 'Run investigation'}
        </button>
      </header>
      <button className={`drawer-backdrop ${drawer ? 'show' : ''}`} aria-label="Close controls" tabIndex={drawer ? 0 : -1} onClick={() => setDrawer(false)} />

      {/* Phones: the three panes are the app's primary tabs. */}
      <nav className="mtabs" aria-label="Case file sections">
        {(
          [
            ['intake', 'Intake'],
            ['investigation', 'Investigation'],
            ['disposition', 'Disposition'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={mobileTab === id ? 'on' : ''} aria-pressed={mobileTab === id} onClick={() => setMobileTab(id)}>
            {label}
            {id === 'disposition' && state.gate && <i className={state.gate.pass ? 'pass' : 'block'} aria-label={state.gate.pass ? 'action allowed' : 'action blocked'} />}
          </button>
        ))}
      </nav>

      <div className="panes" data-tab={mobileTab}>
        <SignalPane feeds={feeds} state={state} photo={photo} vision={vision} visionBusy={visionBusy} onPhoto={(d) => { setPhoto(d); setVision(null); }} onAnalyze={analyze} />

        <main className="pane">
          <div className="pane-title">
            II · Investigation
            <span className="count" style={{ marginLeft: 'auto', letterSpacing: '0.06em' }}>
              {state.scenario ? `${state.scenario.label}` : option.label}
              {state.runId ? ` · run ${state.runId.slice(0, 8)}` : ''}
            </span>
          </div>
          <div className="stepper">
            {STEPS.map((s, i) => (
              <div key={s.id} className={`step ${state.phase === s.id ? 'active' : state.phasesSeen.includes(s.id) || state.phase === 'done' || (stepIdx > i) ? 'done' : ''}`}>
                {s.label}
              </div>
            ))}
          </div>
          <div className="phase-label">{state.error ? <span className="bad">{state.error}</span> : state.phaseLabel || 'Ready'}</div>
          {notice && <div className="card" style={{ borderLeft: '3px solid var(--ochre)', paddingLeft: 12, color: 'var(--ochre)', fontSize: 12.5 }}>{notice}</div>}

          {!started ? (
            <div className="card hero">
              <h2>{scenarioKind === 'reference' ? '125 thermal claims. Seven suspects. One cause.' : option.label}</h2>
              <p>
                {scenarioKind === 'reference'
                  ? 'Traceon pulls signals from warranty, web chatter and live federal feeds, tests every hypothesis against 180,000 units of federated factory data, separates real causes from confounders, and proves the answer before it lets anyone act.'
                  : scenarioKind === 'random'
                    ? 'A hidden cause is planted from a random seed. The agent investigates blind; the truth is revealed only after its verdict.'
                    : option.blurb}
              </p>
              <button className="btn primary" onClick={run} disabled={visionBusy}>
                Run investigation
              </button>
            </div>
          ) : (
            <CausalDag key={runKey} state={state} onSelect={setSelection} />
          )}

          <RevealCard state={state} />
          <div className="grid2">
            <Narrative state={state} />
            <RedTeam state={state} />
            <Robustness state={state} />
            <TimeMachine state={state} />
            <Uncertainty state={state} />
            <Falsifiers state={state} />
          </div>
          <div className="pane-title case-tools-title">Case tools</div>
          <div className="grid2">
            <AskCase id={state.runId} state={state} onOpenExhibit={setExhibit} />
            <WhatIf id={state.runId} state={state} />
          </div>
          <AgentLog state={state} />
        </main>

        <ActionPane key={`a-${runKey}`} state={state} onQuarantined={loadStatus} />
      </div>

      {exhibitItem && <EvidenceModal key={exhibitItem.id} title={`${exhibitItem.id} · ${exhibitItem.label}`} subtitle={exhibitItem.summary} evidence={[exhibitItem]} onClose={() => setExhibit(null)} />}
      {modal && <EvidenceModal key={JSON.stringify(selection)} {...modal} onClose={() => setSelection(null)} />}
    </div>
  );
}
