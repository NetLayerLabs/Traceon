'use client';
// Reviewer mode: a shared, read-only case file. Every exhibit opens as in the
// live case, and reviewers pin comments to individual exhibits.
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { ActionPane } from '@/components/ActionPane';
import { SiteHeader } from '@/components/AppNav';
import { CausalDag } from '@/components/CausalDag';
import { AskCase, Falsifiers, Uncertainty, WhatIf } from '@/components/CaseTools';
import { CommentThread, EvidenceModal } from '@/components/EvidenceModal';
import { Narrative, RedTeam, RevealCard, Robustness, TimeMachine } from '@/components/Insights';
import { renderSelection } from '@/components/Selection';
import type { DagSelection } from '@/components/Selection';
import { foldEvents } from '@/components/state';
import type { CaseComment, SavedCase } from '@/lib/cases';

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<SavedCase | null>(null);
  const [comments, setComments] = useState<CaseComment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selection, setSelection] = useState<DagSelection | null>(null);
  const [exhibit, setExhibit] = useState<string | null>(null);
  const [tab, setTab] = useState<'investigation' | 'disposition'>('investigation');

  useEffect(() => {
    fetch(`/api/cases/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
        setComments(d.comments ?? []);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  const state = useMemo(() => (data ? foldEvents(data.events, null) : null), [data]);
  const onAdd = useCallback(
    async (exhibitId: string | null, author: string, text: string) => {
      const r = await fetch(`/api/cases/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exhibitId, author, text }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setComments((c) => [...c, d]);
    },
    [id]
  );
  const review = { comments, onAdd };

  if (err || !state || !data)
    return (
      <div className="page">
        <SiteHeader subtitle="Case under review" />
        <div className="page-body">{err ? <div className="bad">{err}</div> : <div className="faint pulsing mono">Opening the case file…</div>}</div>
      </div>
    );

  const modal = selection ? renderSelection(selection, state) : null;
  const ex = exhibit ? state.evidence.find((e) => e.id === exhibit) : null;
  const byExhibit = comments.filter((c) => c.exhibitId);
  return (
    <div className="shell case-review">
      <SiteHeader subtitle={`Case ${data.id} · read-only`} action={<a className="btn small ghost" href={`/app?scenario=${encodeURIComponent(data.scenarioId)}`}>Re-run live</a>} />
      <div className="review-banner">
        <span>Review copy · nothing can be changed</span>
        <span>Shared {data.createdAt.slice(0, 10)}</span>
        <span>Proof root {data.ledgerRoot.slice(0, 16)}…</span>
        <span>{comments.length} comments</span>
      </div>
      <nav className="mtabs" aria-label="Case sections" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {(['investigation', 'disposition'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'investigation' ? 'Investigation' : 'Disposition'}
          </button>
        ))}
      </nav>
      <div className="panes review-panes" data-tab={tab}>
        <main className="pane">
          <div className="pane-title">
            Investigation <span className="count" style={{ marginLeft: 'auto' }}>{state.scenario?.label}</span>
          </div>
          <CausalDag state={state} onSelect={setSelection} />
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
            <AskCase id={data.id} state={state} onOpenExhibit={setExhibit} />
            <WhatIf id={data.id} state={state} />
          </div>
          <div className="card">
            <h3>
              Review comments
              <span className="tag warn">{comments.length}</span>
            </h3>
            {byExhibit.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {byExhibit.map((c) => (
                  <div key={c.id} className="comment">
                    <div className="who">
                      <button className="cite-btn" onClick={() => setExhibit(c.exhibitId)}>
                        {c.exhibitId}
                      </button>{' '}
                      {c.author} · {c.at.slice(0, 10)}
                    </div>
                    {c.text}
                  </div>
                ))}
              </div>
            )}
            <CommentThread exhibitId={null} review={review} />
            <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Open any exhibit (a node in the graph, or a cited exhibit) to pin a comment to it.</div>
          </div>
        </main>
        <ActionPane state={state} caseId={data.id} readOnly />
      </div>
      {ex && <EvidenceModal key={ex.id} title={`${ex.id} · ${ex.label}`} subtitle={ex.summary} evidence={[ex]} onClose={() => setExhibit(null)} review={review} />}
      {modal && <EvidenceModal key={JSON.stringify(selection)} {...modal} onClose={() => setSelection(null)} review={review} />}
    </div>
  );
}
