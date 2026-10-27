'use client';
import type { InvState } from './state';

/** ' · cached' when a reply was replayed from the reply cache (older events carry no flag). */
const cachedMark = (x: object) => ('cached' in x && x.cached ? ' · cached' : '');

export function Narrative({ state }: { state: InvState }) {
  const n = state.narrative;
  return (
    <div className="card narrative">
      <h3>
        Explain why
        {n && (
          <span className={`tag ${n.source === 'nemotron' ? 'nv' : ''}`} title={n.fallbackFrom ? `Fallback: ${n.fallbackFrom}` : undefined}>
            {n.source === 'nemotron' ? `${n.via ?? 'Nemotron'}${n.reasoning ? ' · thinking' : ''}${cachedMark(n)}${n.fallbackFrom ? ' · fallback' : ''}` : n.fallbackFrom ? 'template (model reply not used)' : 'template (model unavailable)'}
          </span>
        )}
        {n && (
          <span className={`tag ${n.guard.unverified.length ? 'bad' : 'good'}`} style={{ marginLeft: 4 }} title="Every number in the explanation is checked against the evidence facts">
            {n.guard.verified}/{n.guard.checked} figures verified
          </span>
        )}
      </h3>
      {!n ? (
        <div className="empty">The explanation is written only after every number it may use has been computed and hashed.</div>
      ) : (
        <>
          {n.text.split(/\n\s*\n/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {n.guard.unverified.length > 0 && <div className="bad" style={{ fontSize: 12 }}>Unverified figures flagged: {n.guard.unverified.join(', ')}</div>}
          {n.reasoning && (
            <details className="thinking">
              <summary>Model reasoning trace</summary>
              <pre>{n.reasoning}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function RedTeam({ state }: { state: InvState }) {
  const r = state.redteam;
  return (
    <div className="card">
      <h3>
        Red team
        {r && <span className={`tag ${r.source === 'nemotron' ? 'nv' : ''}`}>{r.source === 'nemotron' ? `${r.via ?? 'Nemotron'}${cachedMark(r)} · devil’s advocate` : 'built-in objections'}</span>}
      </h3>
      {!r ? (
        <div className="empty">A second pass attacks the verdict. Each objection is answered by a deterministic test, not by argument.</div>
      ) : (
        r.objections.map((o, i) => (
          <div className="objection" key={i}>
            <div className="q">“{o.objection}”</div>
            <div className="a">
              {o.check === 'untestable' ? (
                <span className="faint mono">OPEN QUESTION</span>
              ) : r.source === 'nemotron' ? (
                // The model chose which check to run; say what the check found, not that it answers the objection.
                <span className={`mono ${o.survived ? 'good' : 'bad'}`} title="The model chose which check to run for this objection">
                  {o.survived ? 'CHECK PASSED' : 'CHECK FAILED'}
                </span>
              ) : (
                <span className={`mono ${o.survived ? 'good' : 'bad'}`}>{o.survived ? 'ANSWERED' : 'NOT ANSWERED'}</span>
              )}{' '}
              <span className="mono faint">[{o.check}]</span> {o.result}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function rrCell(rr: number) {
  const v = Math.min(rr, 5000);
  const t = Math.min(1, Math.log10(Math.max(1, v)) / 3.3);
  // Ink density encodes effect size, like a printed heat table.
  const bg = `rgba(26, 23, 20, ${0.05 + t * 0.8})`;
  return (
    <span className="cell" style={{ background: bg, color: t > 0.45 ? 'var(--sheet)' : 'var(--ink)' }}>
      {rr >= 1000 ? '≥1000×' : `${rr.toFixed(0)}×`}
    </span>
  );
}

export function Robustness({ state }: { state: InvState }) {
  const rows = state.robustness;
  const causes = [...new Set(rows.map((r) => r.cause))];
  return (
    <div className="card">
      <h3>
        Holds in every subgroup?
        {rows.length > 0 && <span className={`tag ${rows.every((r) => r.consistent) ? 'good' : 'bad'}`}>{rows.filter((r) => r.consistent).length}/{rows.length} consistent</span>}
      </h3>
      {!rows.length ? (
        <div className="empty">Relative risk of each confirmed cause, re-measured inside every firmware, carrier, climate, BMS and warehouse subgroup.</div>
      ) : (
        causes.map((cause) => (
          <div key={cause} style={{ marginBottom: 6 }}>
            {causes.length > 1 && <div className="mono muted" style={{ fontSize: 11, margin: '4px 0' }}>{cause} (other causes excluded)</div>}
            <table className="heat">
              <tbody>
                {rows
                  .filter((r) => r.cause === cause)
                  .map((r) => (
                    <tr key={r.factor}>
                      <th style={{ width: 92 }}>{r.factor}</th>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.strata.map((s) => (
                            <span
                              key={s.stratum}
                              title={`${s.stratum}: ${s.exposedRate.toFixed(0)}/10k vs ${s.baseRate.toFixed(1)}/10k${s.informative ? '' : ' (too few expected failures to judge)'}`}
                              style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', opacity: s.informative ? 1 : 0.45 }}
                            >
                              <span className="faint" style={{ fontSize: 9.5 }}>{s.stratum.replace('WH-', '')}</span>
                              {rrCell(s.rr)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      {state.granularity && (
        <div style={{ marginTop: 8, fontSize: 12 }} className="muted">
          <b className={state.granularity.implicated ? 'bad' : 'good'}>{state.granularity.implicated ? 'Supplier-wide problem' : 'Batch-specific'}:</b> excluding {state.granularity.cause}, cell suppliers fail at{' '}
          {state.granularity.groups.map((g) => `${g.group} ${g.ratePer10k.toFixed(1)}`).join(', ')} per 10k ({state.granularity.pLabel}).
        </div>
      )}
    </div>
  );
}

export function RevealCard({ state }: { state: InvState }) {
  const r = state.reveal;
  if (!r) return null;
  const fmt = (xs: { column: string; group: string }[]) => (xs.length ? xs.map((x) => `${x.column} = ${x.group}`).join(' + ') : 'no defect');
  return (
    <div className="card reveal" data-correct={r.outcome !== 'wrong'}>
      <h3>
        Hidden truth revealed
        <span className={`tag ${r.outcome === 'correct' ? 'good' : r.outcome === 'insufficient' ? 'warn' : 'bad'}`}>
          {r.outcome === 'correct' ? 'agent correct' : r.outcome === 'insufficient' ? 'not enough evidence yet (safe)' : 'agent wrong'}
        </span>
      </h3>
      <div style={{ fontSize: 13 }}>
        <div>
          <span className="muted">Scenario:</span> <b>{r.label}</b> · {r.blurb}
        </div>
        <div style={{ marginTop: 4 }} className="mono">
          <span className="muted">{r.scenarioId.includes('@') ? 'shipped by then:' : 'planted:'}</span> {fmt(r.truth)}
          <br />
          <span className="muted">found:&nbsp;&nbsp;</span> {fmt(r.found)} · gate {r.gateBlocked ? 'blocked' : 'allowed action'}
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
          The agent never sees the planted cause. It is compared only after the verdict, to show the reasoning is not scripted.
        </div>
      </div>
    </div>
  );
}

export function TimeMachine({ state }: { state: InvState }) {
  const t = state.timeline;
  if (!t) {
    // A finished run without a replay: say why instead of keeping the placeholder.
    const why = state.doneMs === null || !state.gate ? null : state.action ? 'this data has no usable failure dates (YYYY-MM-DD)' : 'no cause was confirmed';
    return (
      <div className="card">
        <h3>Early-warning replay</h3>
        <div className="empty">{why ? `No replay for this run: ${why}.` : 'Replays the claim history day by day to show when this defect first became statistically detectable.'}</div>
      </div>
    );
  }
  const W = 560;
  const H = 150;
  const pad = { l: 30, r: 10, t: 12, b: 22 };
  const maxY = Math.max(t.threshold * 1.6, ...t.days.map((d) => d.negLog10P));
  const maxC = Math.max(1, ...t.days.map((d) => d.claims));
  const x = (i: number) => pad.l + (i / Math.max(1, t.days.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (Math.min(v, maxY) / maxY) * (H - pad.t - pad.b);
  const line = t.days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.negLog10P).toFixed(1)}`).join(' ');
  const alertIdx = t.alertDate ? t.days.findIndex((d) => d.date === t.alertDate) : -1;
  return (
    <div className="card">
      <h3>
        Early-warning replay
        {t.alertDate && <span className="tag good">{t.cause}: detectable {t.alertDate}</span>}
      </h3>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', fontFamily: 'var(--mono)' }} role="img" aria-label="Detection strength over time">
        {t.days.map((d, i) => (
          <rect key={d.date} x={x(i) - 3} y={H - pad.b - (d.claims / maxC) * 40} width={6} height={(d.claims / maxC) * 40} className="f-ochre-soft" />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(t.threshold)} y2={y(t.threshold)} className="svg-signal" strokeDasharray="3 3" />
        <text x={W - pad.r} y={y(t.threshold) - 4} className="t-signal" fontSize="9.5" textAnchor="end">
          alert threshold (Bonferroni)
        </text>
        <path d={line} className="svg-ink" strokeWidth="1.6" fill="none" />
        {alertIdx >= 0 && (
          <g>
            <line x1={x(alertIdx)} x2={x(alertIdx)} y1={pad.t} y2={H - pad.b} className="svg-signal" />
            <circle cx={x(alertIdx)} cy={y(t.days[alertIdx].negLog10P)} r="3.5" className="t-signal" />
            <text x={x(alertIdx) + 5} y={pad.t + 10} className="t-signal" fontSize="9.5">
              Traceon alert
            </text>
          </g>
        )}
        <text x={pad.l} y={H - 6} className="t-muted" fontSize="10">{t.days[0]?.date}</text>
        <text x={W - pad.r} y={H - 6} className="t-muted" fontSize="10" textAnchor="end">{t.days[t.days.length - 1]?.date}</text>
        <text x={4} y={pad.t + 6} className="t-muted" fontSize="9">−log₁₀p</text>
      </svg>
      <div className="muted" style={{ fontSize: 12 }}>
        {t.alertDate ? (
          <>
            The batch crossed the multiple-testing alert line on <b className="good">{t.alertDate}</b> with only <b>{t.claimsAtAlert}</b> claims. <b className="warn">{t.claimsAfterAlert}</b> later incidents came after that point and were preventable.
          </>
        ) : (
          'Never crossed the alert threshold.'
        )}
      </div>
    </div>
  );
}

export function AgentLog({ state }: { state: InvState }) {
  // A tested hypothesis id is never "not testable" (the planner sometimes lists one).
  const untestable = state.plan?.untestable.filter((u) => !state.hypotheses.some((h) => h.id === u.trim())) ?? [];
  return (
    <div className="card">
      <h3>
        Agent trace
        {state.markovian && (
          <span className="tag" title="Each step only receives a bounded carryover state, never the full transcript">
            Markovian · {state.markovian.steps} steps · carryover ≤ {state.markovian.maxCarryoverTokens}/{state.markovian.carryoverBudget} tok
          </span>
        )}
      </h3>
      <div className="log">
        {state.logs.length === 0 && <div>Idle.</div>}
        {state.logs.map((l, i) => (
          <div key={i} className={l.tone}>
            {l.text}
          </div>
        ))}
      </div>
      {state.plan && (
        <div style={{ marginTop: 8, fontSize: 11.5 }} className="muted">
          <b>Plan</b> ({state.plan.source === 'nemotron' ? `${state.plan.via ?? 'Nemotron'}${cachedMark(state.plan)}` : 'exhaustive catalog'}): {state.plan.reasoning}
          {untestable.length > 0 && (
            <div className="faint" style={{ marginTop: 4 }}>
              Not testable with this data (logged as open questions): {untestable.join('; ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
