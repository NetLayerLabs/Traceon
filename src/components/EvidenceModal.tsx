'use client';
import { useEffect, useState } from 'react';
import type { CaseComment } from '@/lib/cases';
import type { EvidenceItem } from './state';

export interface ReviewProps {
  comments: CaseComment[];
  onAdd: (exhibitId: string | null, author: string, text: string) => Promise<void>;
}

/** Comments pinned to one exhibit (or to the whole case), with a form to add one. */
export function CommentThread({ exhibitId, review }: { exhibitId: string | null; review: ReviewProps }) {
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem('traceon-reviewer') ?? '';
    } catch {
      return '';
    }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = review.comments.filter((c) => c.exhibitId === exhibitId);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await review.onAdd(exhibitId, author, text);
      setText('');
      try {
        localStorage.setItem('traceon-reviewer', author);
      } catch {}
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="lbl-mono">Reviewer comments{exhibitId ? ` on ${exhibitId}` : ''} · {mine.length}</div>
      {mine.map((c) => (
        <div key={c.id} className="comment">
          <div className="who">
            {c.author} · {c.role} · {c.at.slice(0, 16).replace('T', ' ')} UTC
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
        </div>
      ))}
      <form onSubmit={submit} className="ask-form" style={{ flexWrap: 'wrap' }}>
        <input type="text" placeholder="Your name" value={author} onChange={(e) => setAuthor(e.target.value)} style={{ flex: '0 1 160px' }} aria-label="Your name" maxLength={60} />
        <input type="text" placeholder={exhibitId ? `Comment on ${exhibitId}…` : 'Comment on the case…'} value={text} onChange={(e) => setText(e.target.value)} aria-label="Comment" maxLength={2000} />
        <button className="btn small primary" disabled={busy || !author.trim() || !text.trim()}>
          Post
        </button>
      </form>
      {err && <div className="bad" style={{ fontSize: 12 }}>{err}</div>}
    </div>
  );
}

export function EvidenceModal(props: { title: string; subtitle?: string; body?: React.ReactNode; evidence: EvidenceItem[]; onClose: () => void; review?: ReviewProps }) {
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
                  <span className="id">
                    {e.id}
                    {props.review && props.review.comments.some((c) => c.exhibitId === e.id) && <i className="pin" title="Has reviewer comments" />}
                  </span>
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
            {props.review && <CommentThread exhibitId={selected.id} review={props.review} />}
          </div>
        )}
      </div>
    </div>
  );
}
