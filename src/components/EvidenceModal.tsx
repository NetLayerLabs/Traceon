'use client';
import { useEffect, useState } from 'react';
import type { EvidenceItem } from './state';

export function EvidenceModal(props: { title: string; subtitle?: string; body?: React.ReactNode; evidence: EvidenceItem[]; onClose: () => void }) {
  const [selected, setSelected] = useState<EvidenceItem | null>(props.evidence[0] ?? null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const rows = selected?.query?.rows ?? [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <div className="modal-back" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', alignItems: 'start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <h2>{props.title}</h2>
            {props.subtitle && <div className="muted">{props.subtitle}</div>}
          </div>
          <button className="btn small ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        {props.body && <div style={{ marginTop: 10 }}>{props.body}</div>}

        {props.evidence.length > 0 && (
          <>
            <div className="pane-title" style={{ marginTop: 14 }}>
              Evidence <span className="count">{props.evidence.length}</span>
            </div>
            <div className="ev-list">
              {props.evidence.map((e) => (
                <button key={e.id} className="ev-item" style={selected?.id === e.id ? { background: 'var(--signal-soft)', boxShadow: 'inset 3px 0 0 var(--signal)' } : undefined} onClick={() => setSelected(e)}>
                  <span className="id">{e.id}</span>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{e.label}</span>
                  <span className="s">{e.summary}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {selected && (
          <div style={{ marginTop: 14 }}>
            <dl className="kv">
              <dt>Evidence</dt>
              <dd>
                {selected.id} · {selected.kind}
              </dd>
              {selected.query && (
                <>
                  <dt>Executed via</dt>
                  <dd>
                    <span className={`tag ${selected.query.executedVia === 'ZETARIS_CLOUD' ? 'good' : 'warn'}`}>{selected.query.executedVia}</span> · {selected.query.latencyMs} ms ·{' '}
                    {selected.query.rowCount} rows · {selected.query.queryId}
                  </dd>
                  <dt>Source silos</dt>
                  <dd>{selected.query.sourceSilos.join(' · ')}</dd>
                  {selected.query.fallbackReason && (
                    <>
                      <dt>Cloud fallback</dt>
                      <dd className="warn">{selected.query.fallbackReason}</dd>
                    </>
                  )}
                </>
              )}
              <dt>Proof hash</dt>
              <dd className="hash">{selected.proofHash}</dd>
              <dt>Chain hash</dt>
              <dd className="hash">{selected.chainHash}</dd>
            </dl>
            {selected.query && <pre className="sql">{selected.query.sql}</pre>}
            {selected.query?.cloudSql && selected.query.cloudSql !== selected.query.sql && (
              <div className="faint" style={{ fontSize: 11, margin: '-4px 0 8px' }}>
                Sent to Zetaris as: <span className="mono">{selected.query.cloudSql.replace(/\s+/g, ' ')}</span>
              </div>
            )}
            {rows.length > 0 && (
              <div className="rows-wrap">
                <table className="rows">
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((r, i) => (
                      <tr key={i}>
                        {cols.map((c) => (
                          <td key={c}>{String(r[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!selected.query && selected.payload !== undefined && (
              <pre className="sql" style={{ color: 'var(--muted)', maxHeight: 280, overflow: 'auto' }}>
                {JSON.stringify(selected.payload, null, 2).slice(0, 6000)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
