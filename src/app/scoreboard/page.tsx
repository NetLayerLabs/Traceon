'use client';
// Model versus statistics: how often Nemotron's first guess survived the
// tests, and on generated data (where the truth is known) who was right.
import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/AppNav';
import type { ScoreRecord } from '@/lib/scoreboard';

interface Summary {
  runs: number;
  agreed: number;
  overruled: number;
  withTruth: number;
  modelTopCorrect: number;
  statsCorrect: number;
  modelTopCorrectPct: number | null;
  statsCorrectPct: number | null;
  recent: ScoreRecord[];
}

export default function ScoreboardPage() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    fetch('/api/scoreboard')
      .then((r) => r.json())
      .then(setS)
      .catch(() => {});
  }, []);
  const bar = (pct: number | null, cls: string) => (
    <div className="bar-track" style={{ height: 10, marginTop: 6 }}>
      <div className="bar-fill" style={{ width: `${pct ?? 0}%`, background: cls }} />
    </div>
  );
  return (
    <div className="page">
      <SiteHeader subtitle="Scoreboard · model against statistics" action={<a className="btn small primary" href="/app?scenario=random&autorun=1">Run a blind test</a>} />
      <div className="page-body">
        <div className="page-head">
          <div className="kicker">Scoreboard</div>
          <h1>The model guesses. The statistics decide.</h1>
          <p>
            Nemotron ranks the suspects before any test runs. Every investigation records whether its first guess survived the statistics. On generated scenarios, where the planted cause is known, it also records who was right: the model’s first guess, or the tested verdict.
          </p>
        </div>
        {!s ? (
          <div className="faint pulsing mono">Loading…</div>
        ) : s.runs === 0 ? (
          <div className="empty">No scored runs yet. Investigations count when Nemotron is live and plans the suspects. Run a few random scenarios from the case file.</div>
        ) : (
          <>
            <div className="stat-row">
              <div>
                <div className="lbl">Scored investigations</div>
                <div className="big-num">{s.runs}</div>
              </div>
              <div>
                <div className="lbl">Model’s guess confirmed</div>
                <div className="big-num">{s.agreed}</div>
              </div>
              <div>
                <div className="lbl">Model overruled by the tests</div>
                <div className="big-num bad">{s.overruled}</div>
              </div>
            </div>
            {s.withTruth > 0 && (
              <div className="grid2" style={{ marginTop: 10 }}>
                <div className="card">
                  <h3>Model’s first guess was the planted cause</h3>
                  <div className="big-num">{s.modelTopCorrectPct}%</div>
                  <div className="faint mono" style={{ fontSize: 11 }}>
                    {s.modelTopCorrect} of {s.withTruth} with known truth
                  </div>
                  {bar(s.modelTopCorrectPct, 'var(--ink)')}
                </div>
                <div className="card">
                  <h3>Tested verdict was exactly right</h3>
                  <div className="big-num" style={{ color: 'var(--signal)' }}>{s.statsCorrectPct}%</div>
                  <div className="faint mono" style={{ fontSize: 11 }}>
                    {s.statsCorrect} of {s.withTruth} with known truth
                  </div>
                  {bar(s.statsCorrectPct, 'var(--signal)')}
                </div>
              </div>
            )}
            <div className="card">
              <h3>Recent investigations</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Scenario</th>
                      <th>Model’s first guess</th>
                      <th>Tests confirmed</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recent.map((r) => (
                      <tr key={r.at}>
                        <td className="mono">{r.at.slice(0, 16).replace('T', ' ')}</td>
                        <td className="mono">{r.scenarioId}</td>
                        <td>{r.modelTopTitle}</td>
                        <td className="mono">{r.statsConfirmed.join(', ') || 'nothing'}</td>
                        <td className={r.agreed ? 'good' : 'bad'}>
                          {r.agreed ? 'agreed' : 'overruled'}
                          {r.truthKnown && <span className="faint"> · tests {r.statsCorrect ? 'right' : 'wrong'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
        <div className="faint" style={{ fontSize: 12, marginTop: 14 }}>Offline benchmark (no model): 304/304 generated scenarios and 250/250 held-out scenarios correct, run on 2026-10-25. See the README for the method.</div>
      </div>
    </div>
  );
}
