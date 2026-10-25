'use client';
// What the exhibit sheet shows for each node of the causal proof graph.
import type { DagSelection } from './CausalDag';
import type { InvState } from './state';

export type { DagSelection };

export function renderSelection(sel: DagSelection, state: InvState) {
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
            <span className={c.na ? 'faint' : c.pass ? 'good' : 'bad'}>{c.na ? 'N/A' : c.pass ? '✓' : '✗'}</span>
            <span>{c.label}</span>
            <span className="d">{c.detail}</span>
          </li>
        ))}
      </ul>
    ),
  };
}
