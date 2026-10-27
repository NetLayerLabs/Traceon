'use client';
import { useMemo, useState } from 'react';
import type { FeedResult, RadarItem } from '@/lib/signals';
import type { InvState, VisionFinding } from './state';

const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'warranty', label: 'Warranty' },
  { id: 'web', label: 'Web' },
  { id: 'federal', label: 'Federal' },
  { id: 'news', label: 'News' },
] as const;

export function SignalPane(props: {
  feeds: FeedResult[] | null;
  state: InvState;
  photo: string;
  vision: VisionFinding | null;
  visionBusy: boolean;
  onPhoto: (dataUrl: string) => void;
  onAnalyze: () => void;
}) {
  const { feeds, state } = props;
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('all');
  const matched = useMemo(() => new Set(state.convergence?.matched.map((m) => m.source.split(':').slice(1).join(':')) ?? []), [state.convergence]);
  const items: (RadarItem & { simulated: boolean })[] = useMemo(() => {
    // Items of a simulated feed (e.g. the fictional VR-48 posts) are marked one by one.
    const all = (feeds ?? []).flatMap((f) => f.items.map((i) => ({ ...i, simulated: f.status === 'simulated' })));
    return all
      .filter((i) => kind === 'all' || i.kind === kind)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 80);
  }, [feeds, kind]);

  const conv = state.convergence;
  const maxCity = conv ? Math.max(1, ...Object.values(conv.cities)) : 1;
  const nChannels = conv ? Object.keys(conv.channels).length : 0;
  // The quoted signature describes the VR-48 battery; uploaded data has its own.
  const custom = Boolean(state.scenario?.id.startsWith('custom-'));

  return (
    <aside className="pane">
      <div className="pane-title">I · Evidence intake</div>

      <div className="card">
        <h3>Sources</h3>
        {!feeds && <div className="empty">Polling federal feeds…</div>}
        {feeds?.map((f) => (
          <div className="feed-row" key={f.feed}>
            <span className={`chip ${f.status === 'live' || f.status === 'uploaded' ? 'live' : f.status === 'simulated' ? 'sim' : ''}`} style={{ padding: '1px 7px' }}>
              <span className="dot" />
              {f.status}
            </span>
            <div style={{ minWidth: 0 }}>
              <div>{f.feed}</div>
              <div className="note">{f.note}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>
          H-MEM convergence
          {conv && <span className="tag good">{conv.matched.length} / {conv.totalSignals} signals</span>}
        </h3>
        {!conv ? (
          <div className="empty">Weak signals are stored in Meterless H-MEM and converged when an investigation runs.</div>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {custom ? 'Seen' : <>Signature <span className="mono">“connector · scorch · overheat · smoke”</span> seen</>} from {conv.firstSeen} to {conv.lastSeen} across{' '}
              {nChannels === 1 ? '1 channel' : `${nChannels} channels`}.
            </div>
            <div className="bars">
              {Object.entries(conv.cities)
                .sort((a, b) => b[1] - a[1])
                .map(([city, n]) => (
                  <div className="bar-row" key={city}>
                    <span className="muted">{city}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(n / maxCity) * 100}%` }} />
                    </div>
                    <span className="mono faint">{n}</span>
                  </div>
                ))}
            </div>
            {conv.priorInsights.length > 0 && (
              <div className="tag good" style={{ display: 'block', marginTop: 8, padding: '6px 8px', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                Recalled from a previous session: {conv.priorInsights[0].content}
              </div>
            )}
            <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
              Trust ledger: {Object.entries(conv.ledgerStats).map(([k, v]) => `${k} ${v}`).join(' · ')}
            </div>
          </>
        )}
      </div>

      <VisionCard {...props} />

      <div className="card">
        <h3>Live stream</h3>
        <div className="filters">
          {KINDS.map((k) => (
            <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="signal-list">
          {items.map((i) => (
            <div key={i.id} className={`signal ${i.kind} ${matched.has(i.id) ? 'hit' : ''}`}>
              <div className="meta">
                <b>{i.source}</b>
                {i.simulated && <span className="warn">simulated</span>}
                <span>{i.date}</span>
                {i.city && <span>{i.city}</span>}
                {matched.has(i.id) && <span className="good">● converged</span>}
              </div>
              <div className="body">
                {i.url ? (
                  <a href={i.url} target="_blank" rel="noreferrer">
                    {i.title}
                  </a>
                ) : (
                  <strong style={{ fontWeight: 600 }}>{i.title}</strong>
                )}{' '}
                {i.detail}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** A short label for the photo box: no trailing parenthetical, cut at a word boundary. */
export function boxLabel(component: string, max = 28) {
  const t = component.split('/')[0].trim();
  if (t.length <= max) return t;
  const bare = t.replace(/\s*\(.*$/, '') || t;
  if (bare.length <= max) return bare;
  const sp = bare.lastIndexOf(' ', max);
  return `${bare.slice(0, sp > 0 ? sp : max).replace(/[\s,;:-]+$/, '')}…`;
}

function VisionCard(props: { photo: string; vision: VisionFinding | null; visionBusy: boolean; onPhoto: (d: string) => void; onAnalyze: () => void }) {
  const { vision } = props;
  // Set when the planned route failed and another answered (e.g. Nightshift has no vision route).
  const fallbackFrom = (vision as (VisionFinding & { fallbackFrom?: string }) | null)?.fallbackFrom;
  const onFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => props.onPhoto(String(r.result));
    r.readAsDataURL(f);
  };
  return (
    <div className="card">
      <h3>
        Visual evidence
        <span className={`tag ${vision?.live ? 'nv' : ''}`} title={fallbackFrom ? `Fallback: ${fallbackFrom}` : undefined}>
          {vision ? (vision.live ? (vision.model.includes('·') ? vision.model : 'Nemotron VL') : 'offline reference') : 'not analyzed'}
          {vision?.live && vision.cached ? ' · cached' : ''}
          {fallbackFrom ? ' · fallback' : ''}
        </span>
      </h3>
      <div className="vision-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={props.photo} alt={props.photo.includes('ntsb-787') ? 'NTSB photo: burned lithium-ion battery from a Boeing 787 (2013)' : 'Customer-submitted defect photo'} />
        {vision?.bbox && (
          <div
            className="bbox"
            style={{ left: `${vision.bbox.x * 100}%`, top: `${vision.bbox.y * 100}%`, width: `${vision.bbox.w * 100}%`, height: `${vision.bbox.h * 100}%` }}
          >
            <span title={vision.suspectedComponent}>{boxLabel(vision.suspectedComponent)}</span>
          </div>
        )}
      </div>
      {props.photo.includes('ntsb-787') && (
        <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>
          Sample: a real NTSB evidence photo of a lithium-ion battery after thermal runaway (JAL Boeing 787, Boston, 7 Jan 2013; public domain), standing in for a customer&apos;s photo. Not a VoltRide pack. Upload your own to analyse it.
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <label className="btn small" style={{ flex: 1, textAlign: 'center' }}>
          Upload photo
          <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button className="btn small" style={{ flex: 1 }} onClick={props.onAnalyze} disabled={props.visionBusy}>
          {props.visionBusy ? 'Inspecting…' : 'Analyze'}
        </button>
      </div>
      {vision && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div>
            <b>{vision.physicalFailureMode}</b>
          </div>
          <div className="muted">Component: {vision.suspectedComponent}</div>
          <div className="muted">
            Severity {vision.severityScore}/100 · {vision.isManufacturingDefectLikely ? 'manufacturing defect likely' : 'not a manufacturing defect'}
          </div>
          <div className="faint" style={{ marginTop: 4 }}>{vision.visualEvidenceSummary}</div>
          {vision.live && vision.reasoning && (
            <details className="thinking">
              <summary>Model reasoning trace</summary>
              <pre>{vision.reasoning}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
