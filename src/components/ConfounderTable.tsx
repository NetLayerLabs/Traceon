'use client';
import { useEffect, useRef, useState } from 'react';

// Values from the reference investigation (raw chi-square, then CMH with the
// cell batch held fixed). Reproducible with `npm test`.
const ROWS = [
  { name: 'Firmware v3.4', raw: 'p = 0.44', adj: '—', kind: 'out' },
  { name: 'Carrier shock', raw: 'p = 0.33', adj: '—', kind: 'out' },
  { name: 'Sun Belt heat', raw: 'p = 1.6e-6', adj: 'p = 0.23', kind: 'conf' },
  { name: 'Plant 2', raw: 'p = 3.7e-42', adj: 'p = 0.27', kind: 'conf' },
  { name: 'BMS board', raw: 'p = 5.1e-25', adj: 'p = 0.97', kind: 'conf' },
  { name: 'Supplier B', raw: 'p = 3.7e-42', adj: 'p = 0.27', kind: 'conf' },
  { name: 'Cell batch CB-B-0917', raw: 'p < 1e-300', adj: 'survives all', kind: 'cause' },
] as const;

/**
 * Table 1 as an experiment the reader runs: on raw data five suspects look
 * guilty; holding the cell batch fixed collapses four of them. Plays itself
 * once when scrolled into view, then stays under the reader's control.
 */
export function ConfounderTable() {
  const [held, setHeld] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setHeld(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setTimeout(() => !touched.current && setHeld(true), 1400);
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const verdict = (kind: (typeof ROWS)[number]['kind']) => {
    if (kind === 'out') return { cls: 'out', text: 'Ruled out' };
    if (!held) return { cls: 'suspect', text: 'Looks guilty' };
    return kind === 'cause' ? { cls: 'cause', text: 'Root cause' } : { cls: 'conf', text: 'Confounder' };
  };

  return (
    <div className="lp-table-wrap lp-experiment" ref={ref} data-held={held}>
      <div className="lp-switch-row">
        <button
          className="lp-switch"
          role="switch"
          aria-checked={held}
          onClick={() => {
            touched.current = true;
            setHeld((h) => !h);
          }}
        >
          <span className="track">
            <span className="knob" />
          </span>
          Hold cell batch fixed
        </button>
        <span className="lp-switch-note">{held ? 'Stratified by batch: four effects collapse.' : 'Raw data: five suspects look guilty.'}</span>
      </div>
      <table className="lp-table">
        <thead>
          <tr>
            <th>Suspect</th>
            <th>{held ? 'Batch held fixed' : 'Raw test'}</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => {
            const v = verdict(r.kind);
            return (
              <tr key={r.name} className={held && r.kind === 'cause' ? 'cause' : undefined} style={{ ['--i' as string]: i }}>
                <td className={r.kind === 'out' ? 'out' : undefined}>{r.name}</td>
                <td className="mono">
                  <span key={held ? 'a' : 'r'} className="lp-flip">
                    {held && r.kind !== 'out' ? r.adj : r.raw}
                  </span>
                </td>
                <td>
                  <span key={v.text} className={`lp-verdict ${v.cls} lp-flip`}>
                    {v.text}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <caption>
          <b>Table 1</b> — Raw chi-square tests, then Cochran–Mantel–Haenszel with the cell batch held fixed. The batch fails at 841 per 10k against 0.5 per 10k elsewhere (relative risk 1,668×) and holds in every firmware, carrier, climate, BMS
          and warehouse subgroup.
        </caption>
      </table>
    </div>
  );
}
