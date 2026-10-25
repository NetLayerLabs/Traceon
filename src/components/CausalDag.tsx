'use client';
import type { HypothesisNode, InvState } from './state';

// How each kind of cause reads in the root node, e.g. "Plant P2", "firmware v3.4".
const CAUSE_PREFIX: Record<string, string> = { cell_batch: 'cell batch ', firmware: 'firmware ', plant_id: 'Plant ', carrier: 'carrier ', bms_supplier: '', cell_supplier: '' };

export type DagSelection = { kind: 'cluster' } | { kind: 'hypothesis'; id: string } | { kind: 'root' } | { kind: 'gate' };

const W = 960;
const H = 486;
const NODE_W = 122;
const NODE_H = 88;
const HY = 152; // hypothesis row
const BUS_IN = 122; // signal bus above the suspects
const BUS_OUT = 274; // evidence bus below the suspects

// Drawn like a technical diagram: square nodes, orthogonal wiring, one signal colour.
const STATUS: Record<HypothesisNode['status'], { label: string; box: string; fill: string; label_: string; title: string }> = {
  QUEUED: { label: 'QUEUED', box: 'svg-rule', fill: 'f-sheet', label_: 't-faint', title: 't-faint' },
  TESTING: { label: 'TESTING', box: 'svg-ink', fill: 'f-sheet', label_: 't-ink', title: 't-ink' },
  NO_ASSOCIATION: { label: 'RULED OUT', box: 'svg-rule', fill: 'f-paper', label_: 't-muted', title: 't-muted' },
  SIGNIFICANT: { label: 'SUSPECT', box: 'svg-ochre', fill: 'f-sheet', label_: 't-ochre', title: 't-ink' },
  CONFOUNDED: { label: 'CONFOUNDER', box: 'svg-ochre', fill: 'hatch', label_: 't-ochre', title: 't-ink' },
  CONFIRMED: { label: 'CAUSE', box: 'svg-signal', fill: 'f-signal-soft', label_: 't-signal', title: 't-ink' },
};

function wrap(text: string, max = 16): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

export function CausalDag({ state, onSelect }: { state: InvState; onSelect: (s: DagSelection) => void }) {
  const hs = state.hypotheses;
  const n = Math.max(1, hs.length);
  const gap = 10;
  const totalW = n * NODE_W + (n - 1) * gap;
  const x0 = (W - totalW) / 2;
  const cx = (i: number) => x0 + i * (NODE_W + gap) + NODE_W / 2;
  const cluster = { x: W / 2 - 170, y: 34, w: 340, h: 62 };
  const root = { x: W / 2 - 200, y: 300, w: 400, h: 74 };
  const gate = { x: W / 2 - 130, y: 404, w: 260, h: 54 };
  const confirmedAll = hs.filter((h) => h.status === 'CONFIRMED');
  const confirmed = confirmedAll[0];
  const noCause = Boolean(state.gate) && !confirmed;
  const linked = hs.map((h, i) => ({ h, i })).filter(({ h }) => confirmed && (h.status === 'CONFIRMED' || h.status === 'CONFOUNDED'));
  const conv = state.convergence;
  const gateCls = state.gate ? (state.gate.pass ? 'ink' : 'signal') : 'rule';

  return (
    <div className="dag-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Causal proof graph" style={{ fontFamily: 'var(--mono)' }}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="f-ochre-soft" />
            <line x1="0" y1="0" x2="0" y2="6" className="svg-ochre" strokeWidth="1.2" opacity="0.55" />
          </pattern>
          <marker id="tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8z" className="t-ink" />
          </marker>
          <marker id="tipS" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8z" className="t-signal" />
          </marker>
        </defs>

        {/* signal bus: cluster -> every suspect */}
        {hs.length > 0 && (
          <g fill="none" strokeWidth="1">
            <path d={`M${W / 2} ${cluster.y + cluster.h} V${BUS_IN}`} className="svg-ink" />
            <path d={`M${cx(0)} ${BUS_IN} H${cx(hs.length - 1)}`} className="svg-ink" />
            {hs.map((h, i) => (
              <path key={h.id} d={`M${cx(i)} ${BUS_IN} V${HY - 2}`} className={h.status === 'TESTING' ? 'svg-signal' : 'svg-ink'} strokeWidth={h.status === 'TESTING' ? 2 : 1} markerEnd={h.status === 'TESTING' ? 'url(#tipS)' : 'url(#tip)'} />
            ))}
          </g>
        )}

        {/* evidence bus: cause (solid vermilion) and confounders (dashed ochre) -> root */}
        {linked.length > 0 && (
          <g fill="none">
            {linked.map(({ h, i }) => (
              <path
                key={h.id}
                d={`M${cx(i)} ${HY + NODE_H} V${BUS_OUT}`}
                className={h.status === 'CONFIRMED' ? 'svg-signal' : 'svg-ochre'}
                strokeWidth={h.status === 'CONFIRMED' ? 2.5 : 1.2}
                strokeDasharray={h.status === 'CONFIRMED' ? undefined : '4 3'}
              />
            ))}
            <path d={`M${Math.min(...linked.map((l) => cx(l.i)), W / 2)} ${BUS_OUT} H${Math.max(...linked.map((l) => cx(l.i)), W / 2)}`} className="svg-ink" strokeWidth="1" />
            <path d={`M${W / 2} ${BUS_OUT} V${root.y - 2}`} className="svg-signal" strokeWidth="2.5" markerEnd="url(#tipS)" />
          </g>
        )}

        {/* cluster */}
        <g className="dag-node" onClick={() => onSelect({ kind: 'cluster' })}>
          <rect className="box svg-ink f-sheet" x={cluster.x} y={cluster.y} width={cluster.w} height={cluster.h} strokeWidth="1" />
          <text x={cluster.x + 12} y={cluster.y + 18} className="t-muted" fontSize="9.5" letterSpacing="1.4">
            INCIDENT CLUSTER · H-MEM
          </text>
          <text x={cluster.x + 12} y={cluster.y + 40} className="t-ink" fontSize="19" style={{ fontFamily: 'var(--serif)' }} fontWeight="500">
            {conv ? `${conv.matched.length} converged signals` : 'Awaiting signals'}
          </text>
          <text x={cluster.x + 12} y={cluster.y + 55} className="t-muted" fontSize="10">
            {conv ? `${Object.keys(conv.cities).length} cities · ${Object.keys(conv.channels).length} channels · ${conv.firstSeen} → ${conv.lastSeen}` : ''}
          </text>
        </g>

        {/* suspects */}
        {hs.map((h, i) => {
          const st = STATUS[h.status];
          const x = cx(i) - NODE_W / 2;
          const lines = wrap(h.title);
          const pText = h.status === 'CONFOUNDED' && h.adjusted?.length ? `adj ${maxAdj(h)}` : h.rawTest ? h.rawTest.pLabel : '';
          return (
            <g key={h.id} className={`dag-node ${h.status === 'TESTING' ? 'pulsing' : ''}`} onClick={() => onSelect({ kind: 'hypothesis', id: h.id })}>
              <rect className={`box ${st.box} ${st.fill === 'hatch' ? '' : st.fill}`} fill={st.fill === 'hatch' ? 'url(#hatch)' : undefined} x={x} y={HY} width={NODE_W} height={NODE_H} strokeWidth={h.status === 'CONFIRMED' ? 2 : 1} />
              <text x={x + 9} y={HY + 15} className="t-muted" fontSize="9">
                {h.id}
              </text>
              {lines.map((l, k) => (
                <text key={k} x={x + 9} y={HY + 36 + k * 15} className={st.title} fontSize="13.5" fontWeight="500" style={{ fontFamily: 'var(--serif)' }} textDecoration={h.status === 'NO_ASSOCIATION' ? 'line-through' : undefined}>
                  {l}
                </text>
              ))}
              <text x={x + 9} y={HY + NODE_H - 22} className="t-muted" fontSize="9.5">
                {pText}
              </text>
              <text x={x + 9} y={HY + NODE_H - 8} className={st.label_} fontSize="9" fontWeight="600" letterSpacing="1">
                {st.label}
              </text>
            </g>
          );
        })}

        {/* root cause: the one place the page turns solid */}
        <g className="dag-node" onClick={() => onSelect({ kind: 'root' })} opacity={confirmed || noCause ? 1 : 0.35}>
          <rect className={`box ${confirmed ? 'f-ink svg-ink' : noCause ? 'svg-ochre' : 'svg-rule f-sheet'}`} fill={noCause ? 'url(#hatch)' : undefined} x={root.x} y={root.y} width={root.w} height={root.h} strokeWidth="1" />
          <text x={root.x + 14} y={root.y + 19} className={confirmed ? 't-signal' : noCause ? 't-ochre' : 't-faint'} fontSize="9.5" fontWeight="600" letterSpacing="1.4">
            {confirmedAll.length > 1 ? `${confirmedAll.length} INDEPENDENT ROOT CAUSES` : noCause ? 'NO ACTIONABLE ROOT CAUSE' : 'CONFIRMED ROOT CAUSE'}
          </text>
          <text x={root.x + 14} y={root.y + 44} className={confirmed ? 'f-paper' : 't-ink'} fontSize={confirmedAll.length > 1 ? 16 : 20} fontWeight="500" style={{ fontFamily: 'var(--serif)' }}>
            {confirmed
              ? state.action
                ? state.action.causes.map((c) => `${c.supplier ? `${c.supplier} ` : ''}${CAUSE_PREFIX[c.column] ?? ''}${c.group}`).join('  +  ')
                : confirmedAll.map((c) => c.hotGroup).join('  +  ')
              : noCause
                ? 'Complaints match baseline noise'
                : 'Not yet established'}
          </text>
          <text x={root.x + 14} y={root.y + 62} className={confirmed ? 't-faint' : 't-muted'} fontSize="10">
            {state.action
              ? state.action.causes
                  .map((c) =>
                    c.lots.length === 1
                      ? `Lot ${c.lots[0].lot_id} · Plant ${c.lots[0].plant_id} · SN-${c.lots[0].serial_start}–${c.lots[0].serial_end}`
                      : c.lots.length
                        ? `${c.lots.length} lots · ${c.units.toLocaleString('en-US')} units`
                        : `${c.units.toLocaleString('en-US')} units`
                  )
                  .join('  |  ')
              : confirmed
                ? 'mapping scope…'
                : noCause
                  ? 'No suspect survives testing — a recall would fix nothing'
                  : ''}
          </text>
        </g>

        {/* evidence gate, drawn as a stamp */}
        <path d={`M${W / 2} ${root.y + root.h} V${gate.y - 2}`} className="svg-ink" strokeWidth="1" markerEnd="url(#tip)" />
        <g className="dag-node" onClick={() => onSelect({ kind: 'gate' })} opacity={state.gate ? 1 : 0.35} transform={state.gate ? `rotate(-1.5 ${W / 2} ${gate.y + gate.h / 2})` : undefined}>
          <rect className={`box svg-${gateCls} f-sheet`} x={gate.x} y={gate.y} width={gate.w} height={gate.h} strokeWidth="2" />
          <rect className={`svg-${gateCls}`} fill="none" x={gate.x + 4} y={gate.y + 4} width={gate.w - 8} height={gate.h - 8} strokeWidth="0.8" />
          <text x={W / 2} y={gate.y + 22} className="t-muted" fontSize="9" textAnchor="middle" letterSpacing="1.6">
            EVIDENCE GATE{state.gate ? ` · ${state.gate.criteria.filter((c) => c.pass).length}/${state.gate.criteria.length} CRITERIA` : ''}
          </text>
          <text x={W / 2} y={gate.y + 41} className={state.gate ? (state.gate.pass ? 't-ink' : 't-signal') : 't-faint'} fontSize="14" fontWeight="600" textAnchor="middle" letterSpacing="2.5">
            {state.gate ? (state.gate.pass ? 'ACTION ALLOWED' : 'ACTION BLOCKED') : 'PENDING'}
          </text>
        </g>
      </svg>
      <div className="dag-legend">
        <span>
          <i style={{ background: 'var(--paper)', borderColor: 'var(--rule-2)' }} />
          <s>ruled out</s>: no association
        </span>
        <span>
          <i style={{ background: 'repeating-linear-gradient(45deg, var(--ochre-soft) 0 3px, #d9c49a 3px 4px)', borderColor: 'var(--ochre)' }} />
          confounder: explained away by the cause
        </span>
        <span>
          <i style={{ background: 'var(--signal-soft)', borderColor: 'var(--signal)' }} />
          survives every adjustment
        </span>
        <span className="faint" style={{ marginLeft: 'auto' }}>
          Select any node for its SQL, rows and proof hash
        </span>
      </div>
    </div>
  );
}

/** The confounder's weakest adjusted result (the one that explains it away). */
function maxAdj(h: HypothesisNode) {
  const worst = [...(h.adjusted ?? [])].filter((a) => !a.aliased).sort((a, b) => b.p - a.p)[0];
  return worst ? worst.pLabel : '';
}
