'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ActionPane } from '@/components/ActionPane';
import { CausalDag } from '@/components/CausalDag';
import type { DagSelection } from '@/components/CausalDag';
import { EvidenceModal } from '@/components/EvidenceModal';
import { AgentLog, Narrative, RedTeam, RevealCard, Robustness, TimeMachine } from '@/components/Insights';
import { SignalPane } from '@/components/SignalPane';
import { initialState, reducer } from '@/components/state';
import type { VisionFinding } from '@/components/state';
import type { InvestigationEvent } from '@/lib/investigation';
import { SCENARIO_OPTIONS } from '@/lib/scenarioOptions';
import type { FeedResult } from '@/lib/signals';

const SAMPLE_PHOTO = '/samples/connector-scorch.svg';
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
  nemotron: { live: boolean; model: string; fastModel: string };
  zetaris: { mode: string; host: string | null; parity: { ok: boolean; probes: { sql: string; ok: boolean; error?: string }[] } | null };
  meterless: { memories: number; quarantinedLots: string[] };
  brightdata: { live: boolean };
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

const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [feeds, setFeeds] = useState<FeedResult[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [photo, setPhoto] = useState(SAMPLE_PHOTO);
  const [vision, setVision] = useState<VisionFinding | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [selection, setSelection] = useState<DagSelection | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [scenarioKind, setScenarioKind] = useState('reference');
  const [seed, setSeed] = useState<number>(() => newSeed());
  const [notice, setNotice] = useState<string | null>(null);
  const received = useRef(0); // events applied for the current run (for stream recovery)
  const scenarioId = scenarioKind === 'random' ? `random-${seed}` : scenarioKind;

  const loadStatus = useCallback(() => {
    fetch(`/api/status?scenario=${encodeURIComponent(scenarioId)}`).then((r) => r.json()).then(setStatus).catch(() => {});
  }, [scenarioId]);

  // The signal radar follows the selected scenario.
  useEffect(() => {
    setFeeds(null);
    fetch(`/api/signals?scenario=${encodeURIComponent(scenarioId)}`, { signal: AbortSignal.timeout(30_000) })
      .then((r) => r.json())
      .then((d) => setFeeds(d.feeds ?? []))
      .catch(() => setFeeds([]));
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
    setRunKey((k) => k + 1);
    const v = vision ?? (await analyze());
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
    if (sc && SCENARIO_OPTIONS.some((o) => o.id === sc)) setScenarioKind(sc);
    if (params.has('autorun')) setTimeout(() => document.getElementById('run-btn')?.click(), 50);
  }, []);

  const modal = selection ? renderSelection(selection, state) : null;
  const stepIdx = STEPS.findIndex((s) => s.id === state.phase);
  const started = state.running || state.doneMs !== null || state.hypotheses.length > 0;
  const option = SCENARIO_OPTIONS.find((o) => o.id === scenarioKind)!;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" style={{ color: 'inherit', textDecoration: 'none' }} title="Back to overview">
          <div className="brand-mark" />
          <div>
            <h1>TRACEON</h1>
            <small>Case file · VoltRide VR-48 thermal events</small>
          </div>
        </a>
        <div className="chips">
          <span className={`chip ${status?.nemotron.live ? 'live' : 'sim'}`} title={status?.nemotron.model}>
            <span className="dot" />
            Nemotron {status?.nemotron.live ? 'live' : 'offline'}
          </span>
          <span
            className={`chip ${status?.zetaris.mode === 'ZETARIS_CLOUD' && status.zetaris.parity?.ok ? 'live' : 'sim'}`}
            title={status?.zetaris.parity ? status.zetaris.parity.probes.map((p) => `${p.ok ? 'PASS' : 'FAIL'} ${p.sql}${p.error ? ` (${p.error})` : ''}`).join('\n') : 'Queries run on the local federated mirror'}
          >
            <span className="dot" />
            Zetaris {status?.zetaris.mode === 'ZETARIS_CLOUD' ? `cloud · ${status.zetaris.parity?.ok ? 'parity ok' : 'parity failed'}` : 'local mirror'}
          </span>
          <span className="chip live">
            <span className="dot" />
            H-MEM {status?.meterless.memories ?? 0} memories
          </span>
          <span className={`chip ${status?.brightdata.live ? 'live' : 'sim'}`}>
            <span className="dot" />
            Bright Data {status?.brightdata.live ? 'live' : 'simulated'}
          </span>
        </div>
        <div className="scenario-pick" title={option.blurb}>
          <select value={scenarioKind} onChange={(e) => setScenarioKind(e.target.value)} disabled={state.running} aria-label="Scenario">
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
        <button className="btn ghost small" onClick={reset} disabled={state.running} title="Clear memory and ERP holds">
          Reset demo
        </button>
        <button id="run-btn" className="btn primary" onClick={run} disabled={state.running || visionBusy}>
          {state.running ? 'Investigating…' : started ? 'Re-run investigation' : 'Run investigation'}
        </button>
      </header>

      <div className="panes">
        <SignalPane feeds={feeds} state={state} photo={photo} vision={vision} visionBusy={visionBusy} onPhoto={(d) => { setPhoto(d); setVision(null); }} onAnalyze={analyze} />

        <main className="pane">
          <div className="pane-title">
            II · Investigation
            <span className="count" style={{ marginLeft: 'auto', letterSpacing: '0.06em' }}>
              {state.scenario ? `${state.scenario.label}` : SCENARIO_OPTIONS.find((o) => o.id === scenarioKind)!.label}
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
          </div>
          <AgentLog state={state} />
        </main>

        <ActionPane key={`a-${runKey}`} state={state} onQuarantined={loadStatus} />
      </div>

      {modal && <EvidenceModal key={JSON.stringify(selection)} {...modal} onClose={() => setSelection(null)} />}
    </div>
  );
}

function renderSelection(sel: DagSelection, state: typeof initialState) {
  const byIds = (ids: string[]) => state.evidence.filter((e) => ids.includes(e.id));
  if (sel.kind === 'hypothesis') {
    const h = state.hypotheses.find((x) => x.id === sel.id);
    if (!h) return null;
    return {
      title: `${h.id} · ${h.title}`,
      subtitle: h.claim,
      evidence: byIds(h.evidenceIds),
      body: (
        <div style={{ fontSize: 13 }}>
          <div className="muted" style={{ marginBottom: 6 }}>
            <b>Why it was tested:</b> {h.rationale}
          </div>
          <div style={{ marginBottom: 8 }}>
            <b>Verdict:</b> {h.verdict ?? 'pending'}
          </div>
          {h.rawTest && (
            <div className="bars">
              {[...h.rawTest.groups]
                .sort((a, b) => b.ratePer10k - a.ratePer10k)
                .slice(0, 8)
                .map((g) => {
                  const max = Math.max(...h.rawTest!.groups.map((x) => x.ratePer10k));
                  return (
                    <div className="bar-row" key={g.group} style={{ gridTemplateColumns: '110px 1fr 130px' }}>
                      <span className="mono muted">{g.group}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(g.ratePer10k / max) * 100}%`, background: g.group === h.hotGroup ? 'var(--signal)' : 'var(--ink)' }} />
                      </div>
                      <span className="mono faint">
                        {g.failures}/{g.units.toLocaleString('en-US')} · {g.ratePer10k.toFixed(1)}/10k
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
          {h.adjusted && h.adjusted.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <b>After adjustment (Cochran–Mantel–Haenszel):</b>
              {h.adjusted.map((a) => (
                <div key={a.controlFor} className="mono muted" style={{ fontSize: 11.5 }}>
                  holding {a.controlLabel} fixed → {a.pLabel}, common OR {Number.isFinite(a.commonOddsRatio) ? a.commonOddsRatio.toFixed(2) : '∞'}
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    };
  }
  if (sel.kind === 'cluster') {
    return {
      title: 'Incident cluster',
      subtitle: 'Signals converged by Meterless H-MEM hybrid retrieval',
      evidence: state.evidence.filter((e) => e.kind === 'feed' || e.kind === 'memory'),
      body: state.convergence ? (
        <div className="signal-list" style={{ maxHeight: 220, overflow: 'auto' }}>
          {state.convergence.matched.slice(0, 40).map((m) => (
            <div className="signal" key={m.id}>
              <div className="meta">
                <b>{m.source}</b>
                <span>{m.date}</span>
                <span>relevance {m.relevance}</span>
              </div>
              <div className="body">{m.content}</div>
            </div>
          ))}
        </div>
      ) : undefined,
    };
  }
  if (sel.kind === 'root') {
    const c = state.hypotheses.find((h) => h.status === 'CONFIRMED');
    return {
      title: c ? `Root cause: ${state.hypotheses.filter((h) => h.status === 'CONFIRMED').map((h) => h.hotGroup).join(' + ')}` : 'Root cause',
      subtitle: c?.verdict,
      evidence: state.evidence.filter(
        (e) =>
          state.hypotheses.some((h) => h.status === 'CONFIRMED' && h.evidenceIds.includes(e.id)) ||
          /^(BOM lineage join|Supplier granularity|Symptom concordance|Exposure-time|Blast radius|Residual|Combined coverage|Defect photo forensics)/.test(e.label)
      ),
    };
  }
  return {
    title: 'Evidence gate',
    subtitle: state.gate?.pass ? 'All criteria met; action allowed with human approval.' : 'Action blocked until every criterion is met.',
    evidence: state.evidence.filter((e) => e.kind === 'model' || e.kind === 'stat'),
    body: (
      <ul className="criteria">
        {state.gate?.criteria.map((c) => (
          <li key={c.id}>
            <span className={c.pass ? 'good' : 'bad'}>{c.pass ? '✓' : '✗'}</span>
            <span>{c.label}</span>
            <span className="d">{c.detail}</span>
          </li>
        ))}
      </ul>
    ),
  };
}
