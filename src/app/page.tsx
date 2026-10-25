import type { Metadata } from 'next';
import { ConfounderTable } from '@/components/ConfounderTable';
import { LandingMotion } from '@/components/LandingMotion';
import { LandingNav } from '@/components/LandingNav';
import './landing.css';

export const metadata: Metadata = {
  title: 'Traceon — Defect Forensics',
  description: 'An agent that finds the root cause of a product-safety defect, proves why every other explanation is wrong, and only then lets a human act.',
};

// Figures on this page come from the reference investigation (deterministic
// simulated data, reproducible with `npm test` / `npm run eval`).
const SUSPECTS = [
  { id: 'FW', title: ['Firmware', 'bug'], state: 'out' },
  { id: 'CARRIER', title: ['Carrier', 'shock'], state: 'out' },
  { id: 'HEAT', title: ['Sun Belt', 'heat'], state: 'conf' },
  { id: 'PLANT', title: ['Plant 2', ''], state: 'conf' },
  { id: 'BMS', title: ['BMS', 'board'], state: 'conf' },
  { id: 'SUPPLIER', title: ['Supplier', 'B'], state: 'conf' },
  { id: 'BATCH', title: ['Cell', 'batch'], state: 'root' },
] as const;

function CoverFigure() {
  const W = 560;
  const nodeW = 70;
  const gap = 7;
  const x0 = (W - (SUSPECTS.length * nodeW + (SUSPECTS.length - 1) * gap)) / 2;
  const cx = (i: number) => x0 + i * (nodeW + gap) + nodeW / 2;
  const label = { out: 'RULED OUT', conf: 'CONFOUNDER', root: 'CAUSE' } as const;
  const tone = { out: 't-muted', conf: 't-ochre', root: 't-signal' } as const;
  return (
    <svg viewBox={`0 0 ${W} 330`} role="img" aria-label="Seven suspects tested; six ruled out; one cell batch confirmed">
      <defs>
        <pattern id="lp-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" className="f-ochre-soft" />
          <line x1="0" y1="0" x2="0" y2="5" className="svg-ochre" strokeWidth="1" opacity="0.55" />
        </pattern>
      </defs>
      <rect x={W / 2 - 130} y={6} width={260} height={50} className="svg-ink f-sheet" strokeWidth="1" />
      <text x={W / 2 - 118} y={22} className="t-muted" fontSize="8.5" letterSpacing="1.3">INCIDENT CLUSTER · H-MEM</text>
      <text x={W / 2 - 118} y={44} className="t-ink" fontSize="17" style={{ fontFamily: 'var(--serif)' }}>131 converged signals</text>
      <path d={`M${W / 2} 56 V86 M${cx(0)} 86 H${cx(SUSPECTS.length - 1)}`} className="svg-ink" fill="none" strokeWidth="1" />
      {SUSPECTS.map((s, i) => {
        const x = cx(i) - nodeW / 2;
        const appear = 0.25 + i * 0.3;
        const verdict = s.state === 'out' ? appear + 0.35 : 2.9 + (i - 2) * 0.22;
        return (
          <g key={s.id}>
            <path className="lp-edge svg-ink" style={{ animationDelay: `${appear - 0.2}s` }} d={`M${cx(i)} 86 V108`} fill="none" strokeWidth="1" />
            <g className="lp-h" style={{ animationDelay: `${appear}s` }}>
              <rect x={x} y={108} width={nodeW} height={70} className="svg-rule f-sheet" strokeWidth="1" />
              <text x={x + 7} y={121} className="t-faint" fontSize="7">{s.id}</text>
              <text x={x + 7} y={139} className="t-ink" fontSize="11.5" style={{ fontFamily: 'var(--serif)' }}>{s.title[0]}</text>
              <text x={x + 7} y={152} className="t-ink" fontSize="11.5" style={{ fontFamily: 'var(--serif)' }}>{s.title[1]}</text>
            </g>
            <g className="lp-x" style={{ animationDelay: `${verdict}s` }}>
              <rect
                x={x}
                y={108}
                width={nodeW}
                height={70}
                className={s.state === 'root' ? 'svg-signal f-signal-soft' : s.state === 'conf' ? 'svg-ochre' : 'svg-rule f-paper'}
                fill={s.state === 'conf' ? 'url(#lp-hatch)' : undefined}
                strokeWidth={s.state === 'root' ? 2 : 1}
              />
              <text x={x + 7} y={121} className="t-faint" fontSize="7">{s.id}</text>
              <text x={x + 7} y={139} className={s.state === 'out' ? 't-muted' : 't-ink'} fontSize="11.5" style={{ fontFamily: 'var(--serif)' }} textDecoration={s.state === 'out' ? 'line-through' : undefined}>
                {s.title[0]}
              </text>
              <text x={x + 7} y={152} className={s.state === 'out' ? 't-muted' : 't-ink'} fontSize="11.5" style={{ fontFamily: 'var(--serif)' }} textDecoration={s.state === 'out' && s.title[1] ? 'line-through' : undefined}>
                {s.title[1]}
              </text>
              <text x={x + 7} y={171} className={tone[s.state]} fontSize="7" fontWeight="600" letterSpacing="0.6">{label[s.state]}</text>
              {s.state !== 'out' && (
                <path
                  className={`lp-edge ${s.state === 'root' ? 'svg-signal' : 'svg-ochre'}`}
                  style={{ animationDelay: `${verdict}s` }}
                  d={`M${cx(i)} 178 V204`}
                  fill="none"
                  strokeWidth={s.state === 'root' ? 2.5 : 1}
                  strokeDasharray={s.state === 'root' ? undefined : '3 3'}
                />
              )}
            </g>
          </g>
        );
      })}
      <g className="lp-root" style={{ animationDelay: '4.3s' }}>
        <path d={`M${cx(2)} 204 H${cx(6)} M${W / 2} 204 V226`} className="svg-signal" fill="none" strokeWidth="2" />
        <rect x={W / 2 - 160} y={226} width={320} height={58} className="f-ink" />
        <text x={W / 2 - 146} y={245} className="t-signal" fontSize="8.5" fontWeight="600" letterSpacing="1.3">CONFIRMED ROOT CAUSE</text>
        <text x={W / 2 - 146} y={270} className="f-paper" fontSize="17" style={{ fontFamily: 'var(--serif)' }}>Cell batch CB-B-0917 · Lot L-409</text>
      </g>
      <g className="lp-root" style={{ animationDelay: '4.7s' }} transform={`rotate(-1.5 ${W / 2} 312)`}>
        <rect x={W / 2 - 92} y={296} width={184} height={30} className="svg-ink f-sheet" strokeWidth="1.6" />
        <text x={W / 2} y={316} className="t-ink" fontSize="10.5" fontWeight="600" textAnchor="middle" letterSpacing="2">ACTION ALLOWED</text>
      </g>
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <LandingMotion />
      <LandingNav />

      <header className="lp-cover">
        <div className="lp-wrap">
          <div className="lp-cover-grid">
            <div>
              <h1>
                Find the defect. <em>Prove why.</em> Then act.
              </h1>
              <p className="lp-lede">
                Traceon is a forensic agent for product-safety teams. It assembles scattered warning signs into one case, tests every suspect against factory data, exposes the ones that only look guilty, and quarantines the exact units at risk. Every
                claim it makes comes with a query you can re-run.
              </p>
              <div className="lp-ctas">
                <a className="lp-btn primary big" href="/app">
                  Open the case file <span className="arr">→</span>
                </a>
                <a className="lp-btn big" href="/app?autorun=1">
                  Watch a live investigation
                </a>
              </div>
              <div className="lp-note">About 30 seconds on 180,000 units with live Nemotron; no setup.</div>
            </div>
            <figure className="lp-figure">
              <div className="plate">
                <CoverFigure />
              </div>
              <figcaption>
                <b>Fig. 1</b> — Seven suspects tested against 180,000 units. Two show no link; four look guilty only because they share units with the real cause. One survives every adjustment.
              </figcaption>
            </figure>
          </div>
        </div>
      </header>

      <section className="lp-figures" aria-label="Key figures">
        <div className="lp-wrap" data-reveal data-stagger>
          <div className="lp-fig">
            <b>
              <span data-count="6">6</span> of 7
            </b>
            <span>suspects ruled out, each with its own test</span>
          </div>
          <div className="lp-fig">
            <b data-count="92.8" data-decimals="1" data-suffix="%">
              92.8%
            </b>
            <span>of thermal incidents explained by one batch</span>
          </div>
          <div className="lp-fig">
            <b className="sig" data-count="4.47" data-decimals="2" data-prefix="$" data-suffix="M">
              $4.47M
            </b>
            <span>saved against a blanket recall</span>
          </div>
          <div className="lp-fig">
            <b data-count="3" data-suffix=" claims">
              3 claims
            </b>
            <span>to statistical detection, Oct 10</span>
          </div>
          <div className="lp-fig">
            <b>
              <span data-count="250">250</span> / 250
            </b>
            <span>hidden scenarios solved blind</span>
          </div>
        </div>
      </section>

      <section className="lp-section" id="problem">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <div className="lp-num">01 — Problem</div>
            <div>
              <h2>The warning signs exist weeks before a recall. They sit in four places that never talk to each other.</h2>
              <p>Quality teams join spreadsheets by hand for weeks. When they finally act, they recall everything because they can’t prove which lot is bad, or they blame the wrong cause and miss it entirely.</p>
            </div>
          </div>
          <div className="lp-body">
            <div className="lp-silos" data-reveal data-stagger>
              <div className="lp-silo">
                <div className="t">SOURCE A</div>
                <b>Warranty claims</b>
                <q>Pack hot near the discharge connector.</q>
                <span>125 claims. No pattern visible by eye.</span>
              </div>
              <div className="lp-silo">
                <div className="t">SOURCE B</div>
                <b>Reviews and forums</b>
                <q>Pin 4 has a black burn mark.</q>
                <span>Scattered across Reddit, Amazon and Facebook.</span>
              </div>
              <div className="lp-silo">
                <div className="t">SOURCE C</div>
                <b>Factory and supply chain</b>
                <q>Which lots used cell batch 0917?</q>
                <span>Lots, BOMs, firmware, carriers, warehouses.</span>
              </div>
              <div className="lp-silo">
                <div className="t">SOURCE D</div>
                <b>Federal safety feeds</b>
                <q>Seven e-bike recalls since 2025.</q>
                <span>Live CPSC, openFDA and NHTSA data.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section sheet" id="method">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <div className="lp-num">02 — Method</div>
            <div>
              <h2>An investigation procedure, not a chatbot.</h2>
              <p>The model plans, challenges and explains. Every statistic is computed in code. Each step is recorded as an exhibit you can open.</p>
            </div>
          </div>
          <div className="lp-body">
            <div className="lp-steps" data-reveal data-stagger>
              {[
                ['Converge the signals', 'Meterless H-MEM', 'Stores every weak signal and pulls 131 of them into one thermal-connector cluster across six cities.'],
                ['Plan the suspects', 'Nemotron 3.5', 'Ranks seven testable hypotheses from the evidence and logs the ones the data cannot test.'],
                ['Test every suspect', 'Zetaris SQL', 'A federated query and a significance test for each, across ERP, supplier, telemetry and warehouse data.'],
                ['Unmask confounders', 'Mantel–Haenszel', 'Stratified tests show which suspects stop mattering once the real cause is held fixed.'],
                ['Inspect the photograph', 'Nemotron VL', 'Locates the damage on a customer photo: thermal damage at connector pin 4.'],
                ['Attack the verdict', 'Nemotron red team', 'Raises objections. Each is answered by a deterministic test, or logged as an open question.'],
                ['Pass the evidence gate', 'Seven criteria', 'The quarantine control does not appear until every criterion holds.'],
                ['Act with a named approver', 'Human in the loop', 'Places an ERP hold on 1,380 serials, drafts the notices, and remembers the finding.'],
              ].map(([t, who, d]) => (
                <div className="lp-step" key={t}>
                  <h3>{t}</h3>
                  <span className="who">{who}</span>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="why">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <div className="lp-num">03 — Explain why</div>
            <div>
              <h2>Four suspects looked guilty. Only one was.</h2>
              <p>On raw numbers, heat, the plant, the BMS board and the cell supplier all correlate with failures. A correlation tool would blame them. Traceon asks whether each effect survives once the leading cause is held fixed.</p>
            </div>
          </div>
          <div className="lp-body lp-split">
            <ConfounderTable />
            <div className="lp-marginal" data-reveal>
              Phoenix and Austin really do see more failures, because that is where the bad batch was shipped. Within the batch, and outside it, Sun Belt units fail at the same rate as everywhere else.
              <small>Nemotron’s own first guess was heat. The evidence overruled it, and the agent trace records that.</small>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section sheet" id="blind">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <div className="lp-num">04 — Blind tests</div>
            <div>
              <h2>Same agent, different hidden causes. It finds each one, and refuses to act when there is none.</h2>
              <p>
                The obvious question is whether the answer was planted. So the agent runs blind on scenarios it has never seen: a firmware bug, a bad assembly plant, transit damage, faulty BMS boards, two causes at once, or no defect at all. The
                planted truth is revealed only after the verdict.
              </p>
            </div>
          </div>
          <div className="lp-body lp-split">
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Benchmark</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody data-reveal data-stagger>
                  <tr>
                    <td>Held-out random scenarios (seeds 151–400)</td>
                    <td className="mono">250 / 250</td>
                  </tr>
                  <tr>
                    <td>All scenarios (seeds 1–300 and four named cases)</td>
                    <td className="mono">304 / 304</td>
                  </tr>
                  <tr>
                    <td>Two simultaneous causes</td>
                    <td className="mono">both found</td>
                  </tr>
                  <tr>
                    <td>No defect present</td>
                    <td className="mono">action blocked</td>
                  </tr>
                  <tr>
                    <td>Runs that acted on a wrong cause</td>
                    <td className="mono">0</td>
                  </tr>
                </tbody>
                <caption>
                  <b>Table 2</b> — <span className="mono">npm run eval</span>. Correct means exactly the planted causes found, and action allowed only when a cause exists.
                </caption>
              </table>
            </div>
            <div>
              <div className="lp-bars" data-reveal data-stagger aria-label="Accuracy by planted cause, seeds 1–300 plus named cases">
                {[
                  ['Cell batch', 46],
                  ['Assembly plant', 47],
                  ['Firmware release', 36],
                  ['BMS board supplier', 44],
                  ['Carrier', 41],
                  ['Two causes at once', 44],
                  ['No defect', 46],
                ].map(([label, n]) => (
                  <div className="lp-bar" key={label as string}>
                    <span>{label}</span>
                    <span className="lp-bar-track">
                      <span className="lp-bar-fill" />
                    </span>
                    <span className="mono">
                      {n}/{n}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ margin: '28px 0 20px', font: '19px/1.5 var(--serif)', color: 'var(--ink-2)' }}>Try it yourself. Each run draws a new hidden cause from a random seed.</p>
              <div className="lp-ctas">
                <a className="lp-btn signal" href="/app?scenario=random&autorun=1">
                  Run a hidden scenario <span className="arr">→</span>
                </a>
                <a className="lp-btn" href="/app?scenario=noise&autorun=1">
                  Watch it refuse to recall
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="audit">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <div className="lp-num">05 — Audit</div>
            <div>
              <h2>An agent you can audit, not just believe.</h2>
              <p>Safety decisions are challenged by regulators, suppliers and lawyers. Every answer Traceon gives is built to survive that.</p>
            </div>
          </div>
          <div className="lp-body">
            <dl className="lp-defs" data-reveal data-stagger>
              {[
                ['5.1', 'The model never computes a statistic', 'Every p-value, rate and dollar figure is computed in code and checked against scipy and statsmodels. Nemotron plans, challenges and explains.'],
                ['5.2', 'Every figure in the prose is checked', 'Numbers in the written explanation are matched against the evidence. Anything unverified is flagged.'],
                ['5.3', 'The agent can block itself', 'No quarantine unless significance, confounders, subgroups, residuals, failure signature, red team and scope all pass.'],
                ['5.4', 'Every query is replayable', 'Evidence is hashed into a SHA-256 chain. One control re-runs all 45 queries and verifies each hash and the root.'],
                ['5.5', 'Detection is dated', 'A day-by-day replay shows the defect became detectable on Oct 10 after three claims; 113 later incidents were preventable.'],
                ['5.6', 'Findings are remembered', 'An approved finding becomes long-term H-MEM memory with lineage to its signals. The next investigation recalls it.'],
              ].map(([n, t, d]) => (
                <div className="lp-def" key={n}>
                  <dt data-n={n}>{t}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="lp-section sheet">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <div className="lp-num">— Disposition</div>
            <div>
              <h2>Quarantine 1,380 units, not 180,000.</h2>
              <p>The cause is pinned to one cell batch and mapped to exact serials, SN-88400 to SN-89779. Traceon places the hold across six warehouses and drafts a stop-sale notice and a CPSC Section 15(b) report for counsel.</p>
            </div>
          </div>
          <div className="lp-body lp-split">
            <div>
              <div className="lp-cost" data-reveal>
                <div>
                  <small>Blanket recall</small>
                  <b className="was" data-count="4.5" data-decimals="2" data-prefix="$" data-suffix="M">$4.50M</b>
                  <span>180,000 units</span>
                </div>
                <div>
                  <small>Surgical quarantine</small>
                  <b className="now" data-count="34500" data-prefix="$">$34,500</b>
                  <span>1,380 units</span>
                </div>
              </div>
              <div className="lp-saved" data-reveal>
                <small>Saved</small>
                <b data-count="4465500" data-prefix="$">$4,465,500</b>
              </div>
            </div>
            <div>
              <ul className="lp-gate" data-reveal data-stagger>
                <li><span>Beats the multiple-testing bar</span><span className="d">Bonferroni</span></li>
                <li><span>Survives adjustment for every other suspect</span><span className="d">CMH ×4</span></li>
                <li><span>Consistent in every subgroup</span><span className="d">5 / 5</span></li>
                <li><span>Nothing unexplained remains</span><span className="d">92.8% explained</span></li>
                <li><span>Consistent failure signature</span><span className="d">photo + 85/116</span></li>
                <li><span>Red-team objections answered</span><span className="d">Nemotron</span></li>
                <li><span>Scope mapped to exact serials</span><span className="d">L-409</span></li>
              </ul>
              <div className="lp-stamp" data-reveal>EVIDENCE GATE · ACTION ALLOWED</div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="stack">
        <div className="lp-wrap">
          <div className="lp-head" data-reveal>
            <div className="lp-num">06 — Stack</div>
            <div>
              <h2>Each component does real work, and says when it is not live.</h2>
              <p>The app labels every integration as live, simulated or offline, so nobody has to guess what they are looking at.</p>
            </div>
          </div>
          <div className="lp-body lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Role in the investigation</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody data-reveal data-stagger>
                <tr>
                  <td>NVIDIA Nemotron 3.5</td>
                  <td>Super VL inspects the photo and writes the explanation with thinking on; Lightning plans and red-teams.</td>
                  <td className="mono">live</td>
                </tr>
                <tr>
                  <td>Zetaris</td>
                  <td>Federated SQL across ERP, supplier, telemetry, warehouse and warranty silos, with a hash-parity check.</td>
                  <td className="mono">SQL API · mirror fallback</td>
                </tr>
                <tr>
                  <td>Meterless H-MEM, Markovian</td>
                  <td>Durable signal memory with a trust ledger; a bounded investigation chain.</td>
                  <td className="mono">live, local-first</td>
                </tr>
                <tr>
                  <td>Bright Data</td>
                  <td>Reviews and forum posts, where early complaints surface first.</td>
                  <td className="mono">live with token</td>
                </tr>
                <tr>
                  <td>CPSC, openFDA, NHTSA</td>
                  <td>Base rates for e-bike recalls and lithium-battery incidents.</td>
                  <td className="mono">live</td>
                </tr>
                <tr>
                  <td>Factory and warranty data</td>
                  <td>A fictional company, VoltRide, with planted defects. The agent is never told the answer.</td>
                  <td className="mono">simulated</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap" data-reveal>
          <h2>
            Open the case. <em>Try to break the verdict.</em>
          </h2>
          <p>Select any node to see the SQL behind it. Read the red team’s objections. Then approve the quarantine yourself.</p>
          <div className="lp-ctas">
            <a className="lp-btn primary big" href="/app">
              Open the case file <span className="arr">→</span>
            </a>
            <a className="lp-btn big" href="/app?autorun=1">
              Watch a live investigation
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lp-footer-logo" src="/brand/traceon-lockup.png" alt="Traceon: evidence leads to action." width={1199} height={240} />
          <span>Open Agent Hackathon 2026</span>
          <span>VoltRide and its data are fictional, for demonstration.</span>
        </div>
      </footer>
    </div>
  );
}
