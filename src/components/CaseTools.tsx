'use client';
// Tools that work on a finished case, placed next to the evidence they use:
// uncertainty (forest plot, projection fan), falsifiers, "ask the case",
// the what-if simulator, verification after the fix, documents, review
// sharing and the signed timestamp.
import { useEffect, useMemo, useState } from 'react';
import { chiSquareIndependence, formatP, relativeRisk } from '@/lib/stats';
import type { CounterfactualInputs } from '@/lib/counterfactual';
import type { FollowUpResult } from '@/lib/followup';
import type { AskAnswer } from '@/lib/ask';
import type { ProofStamp } from '@/lib/stamp';
import type { InvState } from './state';

const STATUS_COLOR: Record<string, string> = { CONFIRMED: 'var(--signal)', CONFOUNDED: 'var(--ochre)', SIGNIFICANT: 'var(--ink)', NO_ASSOCIATION: 'var(--faint)' };

/* ---------- Uncertainty: forest plot + projection fan ---------- */
export function Uncertainty({ state }: { state: InvState }) {
  const rows = [...state.forest].sort((a, b) => b.rr - a.rr);
  const a = state.action;
  if (!rows.length)
    return (
      <div className="card">
        <h3>Uncertainty</h3>
        <div className="empty">Each suspect’s relative risk is drawn with its 95% interval once the screen has run.</div>
      </div>
    );
  const W = 380;
  const L = 112;
  const R = 58;
  const rowH = 24;
  const max = Math.min(2000, Math.max(4, ...rows.map((r) => r.hi)));
  const x = (v: number) => L + ((Math.log10(Math.max(0.25, Math.min(v, max))) - Math.log10(0.25)) / (Math.log10(max) - Math.log10(0.25))) * (W - L - R);
  const ticks = [1, 10, 100, 1000].filter((t) => t <= max);
  const H = rows.length * rowH + 30;
  return (
    <div className="card">
      <h3>
        Uncertainty
        <span className="tag">95% intervals</span>
      </h3>
      <div className="forest">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Forest plot of relative risk by suspect">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={6} y2={H - 22} className={t === 1 ? 'svg-ink' : 'svg-rule'} strokeDasharray={t === 1 ? undefined : '2 3'} />
              <text x={x(t)} y={H - 8} textAnchor="middle" className="t-muted" fontSize="10" fontFamily="var(--mono)">
                {t}×
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = 14 + i * rowH;
            const c = STATUS_COLOR[r.status] ?? 'var(--ink)';
            return (
              <g key={r.id}>
                <text x={0} y={y + 4} fontSize="11" className="t-ink">
                  {r.title.length > 18 ? `${r.title.slice(0, 17)}…` : r.title}
                </text>
                <line x1={x(r.lo)} x2={x(r.hi)} y1={y} y2={y} stroke={c} strokeWidth="1.5" />
                <rect x={x(r.rr) - 4} y={y - 4} width="8" height="8" fill={r.status === 'CONFOUNDED' ? 'var(--ochre-soft)' : c} stroke={c} />
                <text x={W - R + 6} y={y + 4} fontSize="10.5" fontFamily="var(--mono)" className={r.status === 'CONFIRMED' ? 't-signal' : 't-muted'}>
                  {r.rr >= 100 ? r.rr.toFixed(0) : r.rr.toFixed(1)}×
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
        Raw relative risk of each suspect’s hottest group against all other units. Ochre suspects look risky here but lose the effect once the true cause is held fixed
        {rows.some((r) => r.adjustedP) ? ` (${rows.filter((r) => r.adjustedP).map((r) => `${r.group}: ${r.adjustedP}`).join('; ')})` : ''}.
      </div>
      {a && (
        <>
          <div className="lbl-mono" style={{ marginTop: 14 }}>Cause estimates</div>
          {a.causes.map((c) => (
            <div key={c.hypothesisId} className="remedy-row">
              <b>{c.group}</b>
              <span className="mono faint">
                rate {c.ratePer10k.toFixed(0)}/10k [{c.rateCI.lo.toFixed(0)}–{c.rateCI.hi.toFixed(0)}] · explains {(c.coverage * 100).toFixed(0)}% [{(c.coverageCI.lo * 100).toFixed(0)}–{(c.coverageCI.hi * 100).toFixed(0)}%]
              </span>
            </div>
          ))}
          <ProjectionFan so={a.incidentsSoFar} mid={a.projectedIncidents30d} lo={a.projectedRange.lo} hi={a.projectedRange.hi} />
        </>
      )}
    </div>
  );
}

function ProjectionFan({ so, mid, lo, hi }: { so: number; mid: number; lo: number; hi: number }) {
  const W = 380;
  const H = 120;
  const top = Math.max(1, so + hi);
  const y = (v: number) => H - 20 - (v / top) * (H - 34);
  const x0 = 8;
  const x1 = 200;
  const x2 = W - 8;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="lbl-mono">Next 30 days without action</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Projected ${mid} more incidents, 90% range ${lo} to ${hi}`} style={{ width: '100%', height: 'auto' }}>
        <line x1={x0} x2={x2} y1={H - 20} y2={H - 20} className="svg-rule" />
        <polyline points={`${x0},${y(0)} ${x1},${y(so)}`} fill="none" className="svg-ink" strokeWidth="1.5" />
        <polygon points={`${x1},${y(so)} ${x2},${y(so + hi)} ${x2},${y(so + lo)}`} className="f-signal-soft" />
        <line x1={x1} y1={y(so)} x2={x2} y2={y(so + mid)} className="svg-signal" strokeWidth="1.5" strokeDasharray="4 3" />
        <line x1={x1} x2={x1} y1={10} y2={H - 20} className="svg-rule" strokeDasharray="2 3" />
        <text x={x1} y={H - 6} textAnchor="middle" fontSize="10" fontFamily="var(--mono)" className="t-muted">
          today · {so}
        </text>
        <text x={x2} y={y(so + hi) - 4} textAnchor="end" fontSize="10.5" fontFamily="var(--mono)" className="t-signal">
          +{mid} (90%: {lo}–{hi})
        </text>
        <text x={x0} y={H - 6} fontSize="10" fontFamily="var(--mono)" className="t-muted">
          first claim
        </text>
      </svg>
    </div>
  );
}

/* ---------- What would falsify this? ---------- */
export function Falsifiers({ state }: { state: InvState }) {
  const causes = state.action?.causes ?? [];
  return (
    <div className="card">
      <h3>
        What would prove this wrong
        {causes.length > 0 && <span className="tag">pre-registered</span>}
      </h3>
      {!causes.length ? (
        <div className="empty">Once a cause is confirmed, the agent commits in advance to the observations that would overturn it.</div>
      ) : (
        causes.map((c) => (
          <div key={c.hypothesisId} style={{ marginBottom: 8 }}>
            {causes.length > 1 && <div className="lbl-mono">{c.group}</div>}
            {c.falsifiers.map((f) => {
              const ratio = f.threshold && f.current !== null ? Math.min(1, f.current / f.threshold) : null;
              const inverse = f.id === 'subgroups' || f.id === 'residual' || f.id === 'signature';
              return (
                <div key={f.id} className="falsifier">
                  <div>
                    <b>{f.label}</b>
                    <div className="faint">{f.rule}</div>
                  </div>
                  <div className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
                    <div>now {fmt(f.current)}</div>
                    <div className="faint">limit {fmt(f.threshold)}</div>
                  </div>
                  {ratio !== null && !inverse && (
                    <div className="bar-track" style={{ gridColumn: '1 / -1' }}>
                      <div className="bar-fill" style={{ width: `${ratio * 100}%`, background: 'var(--ok)' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
const fmt = (v: number | null) => (v === null ? 'n/a' : v !== 0 && Math.abs(v) < 0.01 ? v.toExponential(1) : String(Number(v.toPrecision(3))));

/* ---------- Ask the case ---------- */
const SUGGESTED = ['Why is the Sun Belt heat ruled out?', 'How sure are you, and what would change your mind?', 'Why not recall everything?', 'Which units exactly are affected?'];

export function AskCase({ id, state, onOpenExhibit }: { id: string | null; state: InvState; onOpenExhibit: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<{ q: string; a: AskAnswer | null; error?: string }[]>([]);
  const ready = Boolean(id && state.doneMs !== null && state.ledger);
  const ask = async (question: string) => {
    if (!question.trim() || !id) return;
    setBusy(true);
    setQ('');
    setThread((t) => [...t, { q: question, a: null }]);
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, question }), signal: AbortSignal.timeout(45_000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setThread((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: data } : x)));
    } catch (e) {
      setThread((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card ask">
      <h3>
        Ask the case
        <span className="tag nv">answers cite exhibits</span>
      </h3>
      {!ready ? (
        <div className="empty">After the verdict, ask anything about it. Answers come only from this case’s exhibits, and every figure is checked.</div>
      ) : (
        <>
          {thread.map((t, i) => (
            <div key={i} className="qa">
              <div className="q">{t.q}</div>
              {t.error ? (
                <div className="bad" style={{ fontSize: 12 }}>{t.error}</div>
              ) : !t.a ? (
                <div className="faint pulsing mono" style={{ fontSize: 11 }}>Reading the case file…</div>
              ) : (
                <>
                  <div className="a">
                    {t.a.answer.split(/\n\s*\n/).map((p, j) => (
                      <p key={j}>{linkCites(p, onOpenExhibit)}</p>
                    ))}
                  </div>
                  <div className="qa-meta">
                    <span className={`tag ${t.a.source === 'nemotron' ? 'nv' : ''}`}>{t.a.source === 'nemotron' ? t.a.via ?? 'Nemotron' : 'case file (model unavailable)'}</span>
                    <span className={`tag ${t.a.guard.unverified.length ? 'bad' : 'good'}`}>
                      {t.a.guard.verified}/{t.a.guard.checked} figures verified
                    </span>
                    {t.a.invalidCitations.length > 0 && <span className="tag bad">invalid citation {t.a.invalidCitations.join(', ')}</span>}
                    {t.a.citations.length > 0 && (
                      <span className="faint mono" style={{ fontSize: 11 }}>
                        {t.a.citationsInferred ? 'sources (inferred):' : 'sources:'}{' '}
                        {t.a.citations.map((c) => (
                          <button key={c} className="cite-btn" onClick={() => onOpenExhibit(c)}>
                            {c}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
          {thread.length === 0 && (
            <div className="suggest">
              {SUGGESTED.map((s) => (
                <button key={s} className="btn ghost small" onClick={() => ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
          >
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a suspect, a number, the cost…" aria-label="Question" maxLength={500} />
            <button className="btn small primary" disabled={busy || !q.trim()}>
              Ask
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function linkCites(text: string, open: (id: string) => void) {
  const parts = text.split(/(\[E-\d{2,4}\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(E-\d{2,4})\]$/);
    return m ? (
      <button key={i} className="cite-btn" onClick={() => open(m[1])}>
        {m[1]}
      </button>
    ) : (
      <span key={i}>{p}</span>
    );
  });
}

/* ---------- What if ---------- */
export function WhatIf({ id, state }: { id: string | null; state: InvState }) {
  const [inp, setInp] = useState<CounterfactualInputs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ci, setCi] = useState(0);
  const [day, setDay] = useState(0);
  const [scale, setScale] = useState(100);
  const [frac, setFrac] = useState(100);
  const ready = Boolean(id && state.doneMs !== null && state.action?.causes.length);
  useEffect(() => {
    if (!ready || !id) return;
    fetch(`/api/counterfactual?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setInp(d);
      })
      .catch((e) => setErr((e as Error).message));
  }, [ready, id]);

  const cause = inp?.causes[ci];
  const dates = useMemo(() => {
    if (!inp?.firstClaim) return [];
    const out: string[] = [];
    for (let t = Date.parse(inp.firstClaim); t <= Date.parse(inp.asOf); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }, [inp]);
  useEffect(() => {
    if (dates.length && inp?.alertDate) setDay(Math.max(0, dates.indexOf(inp.alertDate)));
  }, [dates, inp]);

  const sim = useMemo(() => {
    if (!cause || !inp || cause.groups.length < 2) return null;
    const hot = cause.groups.find((g) => g.group === cause.group);
    if (!hot) return null;
    const rest = cause.groups.filter((g) => g.group !== cause.group);
    const restF = rest.reduce((a, g) => a + g.failures, 0);
    const restN = rest.reduce((a, g) => a + g.units, 0);
    const run = (s: number, f: number) => {
      const expected = hot.units * (restF / restN);
      const hotF = Math.max(0, Math.round(expected + (s / 100) * (hot.failures - expected)));
      const groups = cause.groups.map((g) => {
        const fails = g.group === cause.group ? hotF : g.failures;
        return { group: g.group, units: Math.max(1, Math.round((g.units * f) / 100)), failures: Math.round((fails * f) / 100) };
      });
      const t = chiSquareIndependence(groups);
      const h = groups.find((g) => g.group === cause.group)!;
      const others = groups.filter((g) => g.group !== cause.group);
      const rr = relativeRisk(h.failures, h.units, others.reduce((a, g) => a + g.failures, 0), others.reduce((a, g) => a + g.units, 0));
      return { p: t.p, label: formatP(t.p, t.negLog10P), pass: t.p < inp.alpha, rr, hotF: h.failures };
    };
    const now = run(scale, frac);
    // Smallest excess (at full data) and smallest share of the data at which the finding still holds.
    let minScale: number | null = null;
    for (let s = 0; s <= 100; s += 2) if (run(s, 100).pass) { minScale = s; break; }
    let minFrac: number | null = null;
    for (let f = 5; f <= 100; f += 5) if (run(100, f).pass) { minFrac = f; break; }
    return { now, minScale, minFrac };
  }, [cause, inp, scale, frac]);

  const actDate = dates[day];
  const prevented = cause && actDate ? cause.claimsByDay.filter((d) => d.date > actDate).reduce((a, d) => a + d.claims, 0) : 0;

  return (
    <div className="card whatif">
      <h3>
        What if
        <span className="tag">re-runs the statistics</span>
      </h3>
      {!ready ? (
        <div className="empty">Move the sliders to see when acting would have paid off, and how strong the evidence must be for the verdict to hold.</div>
      ) : err ? (
        <div className="bad" style={{ fontSize: 12 }}>{err}</div>
      ) : !inp || !cause ? (
        <div className="faint pulsing mono" style={{ fontSize: 11 }}>Loading the case tables…</div>
      ) : (
        <>
          {inp.causes.length > 1 && (
            <div className="filters">
              {inp.causes.map((c, i) => (
                <button key={c.id} className={ci === i ? 'on' : ''} onClick={() => setCi(i)}>
                  {c.group}
                </button>
              ))}
            </div>
          )}
          {dates.length > 1 && (
            <div className="wi-row">
              <label htmlFor="wi-day">
                Act on <b className="mono">{actDate}</b>
                {inp.alertDate && (
                  <button className="cite-btn" onClick={() => setDay(Math.max(0, dates.indexOf(inp.alertDate!)))}>
                    early-warning date
                  </button>
                )}
              </label>
              <input id="wi-day" type="range" min={0} max={dates.length - 1} value={day} onChange={(e) => setDay(Number(e.target.value))} />
              <div className="wi-out">
                <span className="big-num" style={{ fontSize: 22 }}>{prevented}</span> of {cause.failures} incidents in {cause.group} came after that date and could have been prevented, plus about {inp.projected30d} projected in the next 30 days.
              </div>
            </div>
          )}
          <div className="wi-row">
            <label htmlFor="wi-scale">
              Defect strength: <b className="mono">{scale}%</b> of the observed excess failures
            </label>
            <input id="wi-scale" type="range" min={0} max={100} step={2} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
          </div>
          <div className="wi-row">
            <label htmlFor="wi-frac">
              Data available: <b className="mono">{frac}%</b> of units and claims
            </label>
            <input id="wi-frac" type="range" min={5} max={100} step={5} value={frac} onChange={(e) => setFrac(Number(e.target.value))} />
          </div>
          {sim && (
            <div className={`wi-verdict ${sim.now.pass ? 'pass' : 'fail'}`}>
              <div>
                <b>{sim.now.pass ? 'Still flagged' : 'No longer flagged'}</b> · {sim.now.hotF} failures in {cause.group} · relative risk {sim.now.rr.rr.toFixed(1)}× [{sim.now.rr.lo.toFixed(1)}–{sim.now.rr.hi.toFixed(1)}] · {sim.now.label}
              </div>
              <div className="faint" style={{ fontSize: 11.5 }}>
                With all the data, the finding holds down to {sim.minScale ?? 'n/a'}% of the excess; at full strength it needs {sim.minFrac ?? 'n/a'}% of the data. Bar: Bonferroni alpha {inp.alpha.toExponential(1)} across {inp.hypotheses} suspects. This re-runs the screening test only; a real verdict must also survive the confounder adjustment.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Verification after the fix ---------- */
export function FollowUp({ id }: { id: string | null }) {
  const [res, setRes] = useState<FollowUpResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (mode: 'planned' | 'wrong-fix') => {
    if (!id) return;
    setBusy(mode);
    setErr(null);
    try {
      const r = await fetch('/api/followup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mode }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRes(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const max = res ? Math.max(1, ...res.days.map((d) => d.failures)) : 1;
  return (
    <div className="card">
      <h3>
        Verify the fix
        <span className="tag warn">simulated 30 days</span>
      </h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        A fix is a prediction. Simulate the 30 days after it on this scenario’s own failure rates, then check the pre-registered falsifiers. The same check on real recalls is under <a href="/backtest">Real recalls</a>.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn small" style={{ flex: 1 }} onClick={() => go('planned')} disabled={!id || Boolean(busy)}>
          {busy === 'planned' ? 'Simulating…' : 'After the planned fix'}
        </button>
        <button className="btn small ghost" style={{ flex: 1 }} onClick={() => go('wrong-fix')} disabled={!id || Boolean(busy)} title="Act on the leading confounder instead">
          {busy === 'wrong-fix' ? 'Simulating…' : 'After the wrong fix'}
        </button>
      </div>
      {err && <div className="bad" style={{ fontSize: 12, marginTop: 6 }}>{err}</div>}
      {res && (
        <div style={{ marginTop: 10 }}>
          <div className={`followup-verdict ${res.verdict}`}>{res.verdict === 'verified' ? 'Fix verified · case closed' : 'Fix failed · case reopened'}</div>
          <div className="faint mono" style={{ fontSize: 11, margin: '4px 0 6px' }}>
            Applied: {res.applied.map((a) => `${a.label} ${a.group} (${a.units.toLocaleString('en-US')} units)`).join(' + ')}
          </div>
          <div className="spark" aria-label="New failures per day">
            {res.days.map((d) => (
              <i key={d.day} style={{ height: `${(d.failures / max) * 100}%` }} title={`day ${d.day}: ${d.failures}`} />
            ))}
          </div>
          <ul className="criteria">
            {res.checks.map((c) => (
              <li key={c.id}>
                <span className={c.pass ? 'good' : 'bad'}>{c.pass ? '✓' : '✗'}</span>
                <span>{c.label}</span>
                <span className="d">{c.detail}</span>
              </li>
            ))}
          </ul>
          <div className="muted" style={{ fontSize: 12 }}>{res.summary}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- Documents and review ---------- */
export function Documents({ id, state, shared }: { id: string | null; state: InvState; shared?: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = Boolean(id && state.doneMs !== null && state.ledger);
  const physical = state.action?.causes.some((c) => c.remedy === 'QUARANTINE');
  const share = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const url = `${window.location.origin}${d.url}`;
      setLink(url);
      navigator.clipboard?.writeText(url).catch(() => {});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const href = (kind: string) => `/api/report?id=${encodeURIComponent(id ?? '')}&kind=${kind}`;
  return (
    <div className="card">
      <h3>Reports and review</h3>
      {!done ? (
        <div className="empty">When the case closes, Traceon drafts the 8D report and the supplier claim, and can share the case file for review.</div>
      ) : (
        <>
          <div className="doc-grid">
            <a className={`btn small ${state.action ? '' : 'disabled'}`} href={state.action ? href('8d') : undefined} target="_blank" rel="noreferrer" aria-disabled={!state.action}>
              8D report
            </a>
            <a className={`btn small ${physical ? '' : 'disabled'}`} href={physical ? href('supplier') : undefined} target="_blank" rel="noreferrer" aria-disabled={!physical} title={physical ? '' : 'Only for a physical (supplier) cause'}>
              Supplier claim
            </a>
            {!shared && (
              <button className="btn small primary" onClick={share} disabled={busy}>
                {busy ? 'Sharing…' : 'Share for review'}
              </button>
            )}
          </div>
          {link && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Read-only case link (copied): <a href={link} target="_blank" rel="noreferrer" className="mono" style={{ wordBreak: 'break-all' }}>{link}</a>
              <div className="faint">Reviewers can open every exhibit and pin comments to it. Nothing in the case can be changed.</div>
            </div>
          )}
          {err && <div className="bad" style={{ fontSize: 12, marginTop: 6 }}>{err}</div>}
        </>
      )}
    </div>
  );
}

/* ---------- Signed timestamp ---------- */
export function StampProof({ id, root }: { id: string | null; root: string }) {
  const [stamp, setStamp] = useState<(ProofStamp & { signatureValid?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/proof/stamp?root=${root}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.root && setStamp(d))
      .catch(() => {});
  }, [root]);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/proof/stamp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setStamp({ ...d, signatureValid: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!stamp)
    return (
      <div style={{ marginTop: 8 }}>
        <button className="btn small" style={{ width: '100%' }} onClick={go} disabled={busy || !id}>
          {busy ? 'Signing and timestamping…' : 'Sign and timestamp the root'}
        </button>
        {err && <div className="bad" style={{ fontSize: 12, marginTop: 6 }}>{err}</div>}
      </div>
    );
  return (
    <div className="stamp-box">
      <div>
        <b>Signed</b> {stamp.signedAt.replace('T', ' ').slice(0, 19)} UTC · Ed25519 key <span className="mono">{stamp.key.fingerprint}</span>
        {stamp.signatureValid !== false && <span className="good"> · signature valid</span>}
      </div>
      <div>
        {stamp.ots ? (
          <>
            <b>OpenTimestamps</b> submitted to {new URL(stamp.ots.calendar).host}; Bitcoin confirmation takes a few hours.
          </>
        ) : (
          <span className="warn">Timestamp calendars unreachable ({stamp.otsError}); signature only.</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <a className="btn small" href={`/api/proof/stamp?root=${stamp.root}&file=statement`}>
          Statement
        </a>
        {stamp.ots && (
          <a className="btn small" href={`/api/proof/stamp?root=${stamp.root}&file=ots`}>
            .ots proof
          </a>
        )}
        <a className="btn small ghost" href="/api/proof/key" target="_blank" rel="noreferrer">
          Public key
        </a>
      </div>
      <div className="faint mono" style={{ fontSize: 10.5, marginTop: 6 }}>Verify offline: ots verify {`traceon-${stamp.root.slice(0, 12)}.txt.ots`}</div>
    </div>
  );
}
