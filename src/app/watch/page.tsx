'use client';
// Live watch mode: replays the warranty stream day by day through the same
// screen a monitoring job would run, and opens a case the day it fires.
import { useEffect, useRef, useState } from 'react';
import { SiteHeader } from '@/components/AppNav';
import { SCENARIO_OPTIONS } from '@/lib/scenarioOptions';
import type { WatchReplay } from '@/lib/watch';

const W = 960;
const H = 260;
const PAD = { l: 44, r: 16, t: 14, b: 30 };

export default function WatchPage() {
  const [scenario, setScenario] = useState('reference');
  const [seed, setSeed] = useState(4242);
  const [data, setData] = useState<WatchReplay | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const id = scenario === 'random' ? `random-${seed}` : scenario;

  useEffect(() => {
    setData(null);
    setErr(null);
    setPlaying(false);
    setI(0);
    fetch(`/api/watch?scenario=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (!playing || !data) return;
    timer.current = setInterval(() => {
      setI((x) => {
        const next = x + 1;
        // Stop on the alert day: that is when the case opens.
        if (next >= data.days.length - 1 || data.days[next].date === data.alert?.date) setPlaying(false);
        return Math.min(next, data.days.length - 1);
      });
    }, 1000 / speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, data, speed]);

  const day = data?.days[i];
  const alerted = Boolean(data?.alert && day && day.date >= data.alert.date);
  const n = data?.days.length ?? 1;
  const x = (k: number) => PAD.l + (k / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  // Evidence strength on a log scale so a borderline day and an overwhelming one both read.
  const yMax = data ? Math.log10(1 + Math.max(data.threshold * 3, ...data.days.slice(0, i + 1).map((d) => d.top?.negLog10P ?? 0))) : 1;
  const y = (v: number) => H - PAD.b - (Math.log10(1 + v) / yMax) * (H - PAD.t - PAD.b);
  const maxClaims = data ? Math.max(1, ...data.days.map((d) => d.newClaims)) : 1;
  const alertIdx = data?.alert ? data.days.findIndex((d) => d.date === data.alert!.date) : -1;
  const recent = data ? data.days.slice(0, i + 1).filter((d, k, arr) => k === 0 || d.top?.id !== arr[k - 1].top?.id || d.date === data.alert?.date).slice(-6).reverse() : [];

  return (
    <div className="page">
      <SiteHeader subtitle="Watch · continuous screening" />
      <div className="page-body">
        <div className="page-head">
          <div className="kicker">Live watch</div>
          <h1>Screen every day. Open a case the day it fires.</h1>
          <p>
            Each day the warranty stream is screened across every factor with the same multiple-testing bar the investigation uses. The screen only says something is concentrating; when it fires, a full investigation opens on the data exactly as it stood that day, and decides whether it is a cause or a confounder.
          </p>
        </div>

        <div className="form-row" style={{ marginBottom: 14 }}>
          <label className="field">
            <span>Scenario</span>
            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {SCENARIO_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {scenario === 'random' && (
            <button className="btn ghost small" onClick={() => setSeed(Math.floor(Math.random() * 1e6) + 1)}>
              ↻ #{seed}
            </button>
          )}
          <button className="btn primary" onClick={() => (i >= n - 1 ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))} disabled={!data}>
            {playing ? 'Pause' : i >= n - 1 ? 'Replay' : i > 0 ? 'Resume' : 'Start watching'}
          </button>
          <label className="field">
            <span>Speed</span>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={2}>2 days/s</option>
              <option value={4}>4 days/s</option>
              <option value={10}>10 days/s</option>
            </select>
          </label>
          <button className="btn ghost small" onClick={() => (setPlaying(false), setI(n - 1))} disabled={!data}>
            Skip to today
          </button>
        </div>

        {err && <div className="bad">{err}</div>}
        {!data && !err && <div className="faint pulsing mono">Loading the warranty stream…</div>}
        {data && day && (
          <>
            <div className="stat-row">
              <div>
                <div className="lbl">Date</div>
                <div className="big-num" style={{ fontSize: 22 }}>{day.date}</div>
              </div>
              <div>
                <div className="lbl">Units in the field</div>
                <div className="big-num" style={{ fontSize: 22 }}>{day.units.toLocaleString('en-US')}</div>
              </div>
              <div>
                <div className="lbl">Claims so far</div>
                <div className="big-num" style={{ fontSize: 22 }}>{day.claims}</div>
              </div>
              <div>
                <div className="lbl">Strongest factor</div>
                <div style={{ font: '500 15px/1.3 var(--serif)' }}>{day.top ? `${day.top.title} · ${day.top.group}` : 'too few claims'}</div>
              </div>
              <div style={{ background: alerted ? 'var(--signal)' : undefined, color: alerted ? '#fff' : undefined }}>
                <div className="lbl" style={{ color: alerted ? '#fde' : undefined }}>Status</div>
                <div style={{ font: '500 16px/1.3 var(--serif)' }}>{alerted ? `Alert on ${data.alert!.date}` : 'Quiet'}</div>
              </div>
            </div>

            <div className="chart">
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily screening strength and new claims">
                {data.days.map((d, k) => (
                  <rect key={d.date} x={x(k) - 2} width={4} y={H - PAD.b - (d.newClaims / maxClaims) * 46} height={(d.newClaims / maxClaims) * 46} className={k <= i ? 'f-ink' : 'f-paper'} opacity={k <= i ? 0.18 : 1} />
                ))}
                <line x1={PAD.l} x2={W - PAD.r} y1={y(data.threshold)} y2={y(data.threshold)} className="svg-signal" strokeDasharray="5 4" />
                <text x={W - PAD.r} y={y(data.threshold) - 5} textAnchor="end" fontSize="10.5" fontFamily="var(--mono)" className="t-signal">
                  alert bar · p &lt; {(10 ** -data.threshold).toExponential(1)}
                </text>
                <polyline
                  fill="none"
                  className="svg-ink"
                  strokeWidth="1.8"
                  points={data.days
                    .slice(0, i + 1)
                    .map((d, k) => `${x(k)},${y(d.top?.negLog10P ?? 0)}`)
                    .join(' ')}
                />
                {alertIdx >= 0 && alertIdx <= i && (
                  <g>
                    <line x1={x(alertIdx)} x2={x(alertIdx)} y1={PAD.t} y2={H - PAD.b} className="svg-signal" />
                    <rect x={x(alertIdx) - 5} y={y(data.days[alertIdx].top!.negLog10P) - 5} width="10" height="10" fill="var(--signal)" />
                  </g>
                )}
                <line x1={x(i)} x2={x(i)} y1={PAD.t} y2={H - PAD.b} className="svg-rule" />
                {[0, Math.floor((n - 1) / 2), n - 1].map((k) => (
                  <text key={k} x={x(k)} y={H - 10} textAnchor={k === 0 ? 'start' : k === n - 1 ? 'end' : 'middle'} fontSize="10" fontFamily="var(--mono)" className="t-muted">
                    {data.days[k].date}
                  </text>
                ))}
                <text x={4} y={PAD.t + 8} fontSize="10" fontFamily="var(--mono)" className="t-muted">
                  −log₁₀ p
                </text>
              </svg>
              <input type="range" min={0} max={n - 1} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} style={{ width: '100%', accentColor: 'var(--signal)' }} aria-label="Day" />
            </div>

            <div className="grid2">
              <div className="card">
                <h3>{alerted ? 'Case opened' : 'Screen'}</h3>
                {alerted && data.alert ? (
                  <>
                    <p style={{ font: '17px/1.5 var(--serif)', margin: '0 0 10px' }}>
                      On <b>{data.alert.date}</b>, after {data.alert.claims} claims, failures concentrated in <b>{data.alert.title.toLowerCase()}</b> ({data.alert.group}) beyond the bar. A case opens on the data as it stood that day.
                    </p>
                    <a className="btn primary" href={`/app?scenario=${encodeURIComponent(data.alert.caseId)}&autorun=1`}>
                      Investigate as of {data.alert.date}
                    </a>
                    <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>The screen flags association only. The investigation tests confounders and may still block action if the evidence is not there yet.</div>
                  </>
                ) : data.alert ? (
                  <div className="empty">Nothing beyond the bar yet. Keep watching.</div>
                ) : (
                  <div className="empty">{i >= n - 1 ? 'The whole history stayed under the bar: no case opened, no recall.' : 'Nothing beyond the bar yet. Keep watching.'}</div>
                )}
              </div>
              <div className="card">
                <h3>Watch log</h3>
                <div className="log" style={{ maxHeight: 200 }}>
                  {recent.map((d) => (
                    <div key={d.date} className={d.date === data.alert?.date ? 'bad' : ''}>
                      {d.date} · {d.claims} claims · {d.top ? `${d.top.title} ${d.top.group} (−log₁₀ p ${d.top.negLog10P.toFixed(1)})` : 'waiting for 5 claims'}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
