'use client';
// Real-recall time machine: replay public NHTSA complaint histories and show
// when a standard safety-signal test would have fired, against the date of
// the manufacturer's recall.
import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/AppNav';
import type { Backtest } from '@/lib/realRecall';

type Summary = Omit<Backtest, 'series' | 'firesBeforeAlert'> & { firesBeforeAlertCount: number };

const VERDICT: Record<string, { label: string; cls: string }> = {
  early: { label: 'flagged before the recall', cls: 'bad' },
  late: { label: 'recall came first', cls: 'faint' },
  'no-recall': { label: 'signal, no fire recall', cls: 'warn' },
  'no-signal': { label: 'no signal', cls: 'faint' },
};
const days = (n: number | null) => (n === null ? 'n/a' : `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`);

export default function BacktestPage() {
  const [cases, setCases] = useState<Summary[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [bt, setBt] = useState<Backtest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState({ make: '', model: '', years: '' });
  const [liveBusy, setLiveBusy] = useState(false);

  useEffect(() => {
    fetch('/api/backtest')
      .then((r) => r.json())
      .then((d) => {
        setCases(d.cases);
        setSel(d.cases[0]?.id ?? null);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(() => {
    if (!sel || sel.startsWith('live-')) return;
    setBt(null);
    fetch(`/api/backtest?case=${sel}`)
      .then((r) => r.json())
      .then(setBt)
      .catch((e) => setErr((e as Error).message));
  }, [sel]);

  const runLive = async (e: React.FormEvent) => {
    e.preventDefault();
    setLiveBusy(true);
    setErr(null);
    try {
      const years = live.years
        .split(/[,\s]+/)
        .flatMap((y) => (y.includes('-') ? range(y) : [Number(y)]))
        .filter(Boolean);
      const r = await fetch('/api/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ make: live.make, model: live.model, years }), signal: AbortSignal.timeout(280_000) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSel(d.id);
      setBt(d);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setLiveBusy(false);
    }
  };

  const early = cases?.filter((c) => c.headline?.verdict === 'early') ?? [];
  return (
    <div className="page">
      <SiteHeader subtitle="Real recalls · NHTSA backtest" />
      <div className="page-body">
        <div className="page-head">
          <div className="kicker">Real-recall time machine</div>
          <h1>Would the signal have fired before the recall?</h1>
          <p>
            Public NHTSA complaint histories, replayed one day at a time through the standard pharmacovigilance signal test: a vehicle’s share of fire complaints for a component against the same share across ten popular comparator vehicles (proportional reporting ratio at least 2, Yates chi-square at least 4, at least 3 cases).
            {early.length > 0 && ` On ${early.length} of ${cases!.length} vehicles, the signal fired before the manufacturer’s fire recall.`}
          </p>
        </div>

        {err && <div className="bad" style={{ marginBottom: 10 }}>{err}</div>}
        {!cases && !err && <div className="faint pulsing mono">Replaying complaint histories…</div>}
        {cases && (
          <div className="case-cards" role="tablist">
            {cases.map((c) => {
              const v = VERDICT[c.headline?.verdict ?? 'no-signal'];
              return (
                <button key={c.id} className={sel === c.id ? 'on' : ''} onClick={() => setSel(c.id)} role="tab" aria-selected={sel === c.id}>
                  <span className="mono faint" style={{ fontSize: 10.5 }}>
                    {c.years[0]}–{c.years[c.years.length - 1]}
                  </span>
                  <span className="n">{titleCase(c.vehicle)}</span>
                  <span className={`v ${v.cls}`}>{c.headline?.verdict === 'early' ? `${days(c.headline.leadDays)} early` : v.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {bt && <BacktestView bt={bt} />}

        <div className="card" style={{ marginTop: 28 }}>
          <h3>Try any vehicle (live from api.nhtsa.gov)</h3>
          <form className="form-row" onSubmit={runLive}>
            <label className="field">
              <span>Make</span>
              <input value={live.make} onChange={(e) => setLive({ ...live, make: e.target.value })} placeholder="TESLA" />
            </label>
            <label className="field">
              <span>Model</span>
              <input value={live.model} onChange={(e) => setLive({ ...live, model: e.target.value })} placeholder="MODEL Y" />
            </label>
            <label className="field">
              <span>Model years</span>
              <input value={live.years} onChange={(e) => setLive({ ...live, years: e.target.value })} placeholder="2020-2022" />
            </label>
            <button className="btn primary" disabled={liveBusy || !live.make || !live.model || !live.years}>
              {liveBusy ? 'Fetching complaints…' : 'Replay'}
            </button>
          </form>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Fetches every complaint and recall for the vehicle and the comparator pool (cached after the first run). A first run can take a minute or two.</div>
        </div>
      </div>
    </div>
  );
}

function range(s: string) {
  const [a, b] = s.split('-').map(Number);
  return a && b && b >= a && b - a < 6 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [];
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bEv\b/, 'EV');

function BacktestView({ bt }: { bt: Backtest }) {
  const h = bt.headline;
  return (
    <>
      <div className="stat-row">
        <div>
          <div className="lbl">Complaints</div>
          <div className="big-num" style={{ fontSize: 22 }}>{bt.totals.complaints.toLocaleString('en-US')}</div>
          <div className="faint mono" style={{ fontSize: 10.5 }}>{bt.totals.fires} mention fire</div>
        </div>
        <div>
          <div className="lbl">Comparator pool</div>
          <div className="big-num" style={{ fontSize: 22 }}>{bt.totals.comparatorComplaints.toLocaleString('en-US')}</div>
          <div className="faint mono" style={{ fontSize: 10.5 }}>{bt.totals.comparatorFires} mention fire</div>
        </div>
        <div>
          <div className="lbl">Signal fired</div>
          <div className="big-num" style={{ fontSize: 22 }}>{h?.alert?.date ?? 'never'}</div>
          {h?.alert && <div className="faint mono" style={{ fontSize: 10.5 }}>{h.component} · PRR {h.alert.prr} · {h.alert.cases} cases</div>}
        </div>
        <div>
          <div className="lbl">Fire recall</div>
          <div className="big-num" style={{ fontSize: 22 }}>{h?.recall?.date ?? 'none'}</div>
          {h?.recall && <div className="faint mono" style={{ fontSize: 10.5 }}>{h.recall.campaign}</div>}
        </div>
        <div style={{ background: h?.verdict === 'early' ? 'var(--signal)' : undefined, color: h?.verdict === 'early' ? '#fff' : undefined }}>
          <div className="lbl" style={{ color: h?.verdict === 'early' ? '#fde' : undefined }}>Lead time</div>
          <div className="big-num" style={{ fontSize: 22 }}>{h?.verdict === 'early' ? days(h.leadDays) : h?.verdict === 'late' ? `−${days(h.leadDays)}` : 'n/a'}</div>
        </div>
      </div>

      {bt.series.length > 1 && h && <SignalChart bt={bt} />}

      <div className="grid2">
        <div className="card">
          <h3>
            Fire complaints up to the signal
            <span className="tag">{bt.firesBeforeAlert.length}</span>
          </h3>
          {bt.firesBeforeAlert.length ? (
            bt.firesBeforeAlert.map((c) => (
              <div key={c.o} className="signal federal">
                <div className="meta">
                  <b>{c.d}</b>
                  <span>NHTSA ODI {c.o}</span>
                  <span>{c.c.join(', ')}</span>
                </div>
                <div className="body">{c.s}</div>
              </div>
            ))
          ) : (
            <div className="empty">No signal fired on this vehicle.</div>
          )}
        </div>
        <div className="card">
          <h3>Every component</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Fires</th>
                  <th>Signal</th>
                  <th>Fire recall</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {bt.components.slice(0, 12).map((c) => (
                  <tr key={c.component}>
                    <td className="mono">{c.component}</td>
                    <td>{c.fires}</td>
                    <td className="mono">{c.alert?.date ?? '·'}</td>
                    <td className="mono">{c.recall ? `${c.recall.date} ${c.recall.campaign}` : '·'}</td>
                    <td className={VERDICT[c.verdict].cls}>{c.verdict === 'early' ? `${days(c.leadDays)} early` : c.verdict === 'late' ? `${days(c.leadDays)} late` : VERDICT[c.verdict].label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {h?.recall && (
        <div className="card">
          <h3>The recall</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            <b className="mono">{h.recall.campaign}</b> ({h.recall.component}): {h.recall.summary}
          </p>
        </div>
      )}
      <div className="faint" style={{ fontSize: 12, borderLeft: '3px solid var(--ochre)', paddingLeft: 10 }}>
        Caveat: a match is by component family and fire wording in the complaint, not proof that the signal and the recall concern the same defect. Complaints have no sales denominator, so the test compares shares of complaints, not failure rates. Data: {bt.source}, fetched {bt.fetchedAt}.
      </div>
    </>
  );
}

function SignalChart({ bt }: { bt: Backtest }) {
  const W = 960;
  const H = 240;
  const P = { l: 46, r: 16, t: 14, b: 28 };
  const s = bt.series;
  const t0 = Date.parse(s[0].d);
  const recall = bt.headline?.recall?.date;
  const t1 = Math.max(Date.parse(s[s.length - 1].d), recall ? Date.parse(recall) : 0);
  const x = (d: string) => P.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const maxPrr = Math.max(4, ...s.map((p) => p.prr));
  const y = (v: number) => H - P.b - (Math.log10(Math.max(0.5, v) / 0.5) / Math.log10(maxPrr / 0.5)) * (H - P.t - P.b);
  const maxCases = Math.max(1, ...s.map((p) => p.cases));
  const alert = bt.headline?.alert?.date;
  const years = [];
  for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) years.push(`${yr}-01-01`);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Proportional reporting ratio over time">
        {s.map((p) => (
          <rect key={p.d} x={x(p.d) - 1} width={2} y={H - P.b - (p.cases / maxCases) * 40} height={(p.cases / maxCases) * 40} className="f-ink" opacity={0.15} />
        ))}
        {years.map((d) => (
          <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="10" fontFamily="var(--mono)" className="t-muted">
            {d.slice(0, 4)}
          </text>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(2)} y2={y(2)} className="svg-signal" strokeDasharray="5 4" />
        <text x={P.l + 4} y={y(2) - 5} fontSize="10.5" fontFamily="var(--mono)" className="t-signal">
          PRR 2 (signal bar)
        </text>
        <polyline fill="none" className="svg-ink" strokeWidth="1.6" points={s.map((p) => `${x(p.d)},${y(p.prr)}`).join(' ')} />
        {alert && (
          <g>
            <line x1={x(alert)} x2={x(alert)} y1={P.t} y2={H - P.b} className="svg-signal" />
            <text x={x(alert) - 4} y={P.t + 10} textAnchor="end" fontSize="10.5" fontFamily="var(--mono)" className="t-signal" paintOrder="stroke" stroke="var(--sheet)" strokeWidth="4">
              signal {alert}
            </text>
          </g>
        )}
        {recall && (
          <g>
            <line x1={x(recall)} x2={x(recall)} y1={P.t} y2={H - P.b} className="svg-ink" strokeDasharray="2 3" />
            <text x={x(recall) + 4} y={P.t + 26} fontSize="10.5" fontFamily="var(--mono)" className="t-ink" paintOrder="stroke" stroke="var(--sheet)" strokeWidth="4">
              recall {recall}
            </text>
          </g>
        )}
        <text x={4} y={P.t + 8} fontSize="10" fontFamily="var(--mono)" className="t-muted">
          PRR
        </text>
      </svg>
      <div className="faint mono" style={{ fontSize: 10.5, padding: '2px 4px 4px' }}>
        {bt.headline?.component} fire complaints: proportional reporting ratio (line, log scale) and cumulative cases (bars)
      </div>
    </div>
  );
}
