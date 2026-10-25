'use client';
import { useState } from 'react';
import type { InvState } from './state';

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString('en-US')}`);

const REMEDY_LABEL: Record<string, string> = {
  QUARANTINE: 'Surgical quarantine',
  OTA_ROLLBACK: 'OTA firmware rollback',
  CARRIER_INSPECTION: 'In-transit inspection',
  ADVISORY: 'Customer advisory',
};

interface RemediationResult {
  holdId: string;
  alreadyQuarantined: boolean;
  unitsHeld: number;
  warehouses: { warehouse_id: string; region: string; units: number }[];
  otherActions: { label: string; units: number; jobId: string; group: string }[];
  costUsd: number;
  memoryInsightId: string;
  erpHoldRowCount: number;
  notices: Record<string, string>;
}

interface VerifyResult {
  ok: boolean;
  root: string;
  replayedQueries: number;
  mismatches: { id: string; label: string }[];
}

const NOTICE_TITLES: Record<string, string> = { distributor: 'Stop-sale notice', ota: 'OTA rollback order', operations: 'Operations order', regulator: 'CPSC 15(b) draft' };

function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ActionPane({ state, onQuarantined }: { state: InvState; onQuarantined: () => void }) {
  const [approver, setApprover] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RemediationResult | null>(null);
  const [tab, setTab] = useState<string>('');
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = state.action;
  const gate = state.gate;
  const scenario = state.scenario?.id ?? 'reference';
  const noCause = Boolean(gate) && !a;

  const execute = async () => {
    if (!a || !state.ledger) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/quarantine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, causes: a.causes.map((c) => ({ column: c.column, group: c.group, remedy: c.remedy })), approvedBy: approver, ledgerRoot: state.ledger.root }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      setTab(Object.keys(data.notices)[0] ?? '');
      onQuarantined();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    setErr(null);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidence: state.evidence, scenario }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVerify(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setVerifying(false);
    }
  };

  const bundle = () =>
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scenario,
        ledgerRoot: state.ledger?.root,
        gate,
        hypotheses: state.hypotheses.map(({ id, title, status, verdict, rawTest, adjusted }) => ({ id, title, status, verdict, pLabel: rawTest?.pLabel, adjusted })),
        explanation: state.narrative?.text,
        action: a,
        remediation: result ? { holdId: result.holdId, unitsHeld: result.unitsHeld, otherActions: result.otherActions } : null,
        reveal: state.reveal,
        evidence: state.evidence,
      },
      null,
      2
    );

  const warehouses = a ? mergeWarehouses(a.causes.filter((c) => c.remedy === 'QUARANTINE').flatMap((c) => c.byWarehouse)) : [];

  return (
    <aside className="pane right">
      <div className="pane-title">III · Disposition</div>

      <div className="card">
        <h3>Recall cost</h3>
        {noCause ? (
          <>
            <div className="cost-compare">
              <div className="cost-box">
                <div className="lbl">Blanket recall</div>
                <div className="big-num bad">{usd(180_000 * 25)}</div>
                <div className="faint">would fix nothing</div>
              </div>
              <div className="cost-box surgical">
                <div className="lbl">Traceon</div>
                <div className="big-num good">$0</div>
                <div className="faint">monitor, no recall</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              No suspect survives testing, so there is nothing to recall. The agent blocks action and keeps watching.
            </div>
          </>
        ) : !a ? (
          <div className="empty">Cost impact appears once the root cause is mapped to exact units.</div>
        ) : (
          <>
            <div className="cost-compare">
              <div className="cost-box">
                <div className="lbl">Blanket recall</div>
                <div className="big-num bad">{usd(a.blanketCostUsd)}</div>
                <div className="faint">{a.blanketUnits.toLocaleString('en-US')} units</div>
              </div>
              <div className="cost-box surgical">
                <div className="lbl">Traceon remedy</div>
                <div className="big-num good">{usd(a.surgicalCostUsd)}</div>
                <div className="faint">{a.affectedUnits.toLocaleString('en-US')} units</div>
              </div>
            </div>
            <div className="savings">
              <span className="muted">Saved</span>
              <span className="big-num good">{usd(a.savingsUsd)}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {a.causes.map((c) => (
                <div key={c.hypothesisId} className="remedy-row">
                  <span className="tag bad">{REMEDY_LABEL[c.remedy]}</span>
                  <span>
                    <b>{c.group}</b> · {c.units.toLocaleString('en-US')} units · {usd(c.costUsd)}
                  </span>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              <b className="warn">{a.incidentsSoFar}</b> incidents so far. Without action, about <b className="bad">{a.projectedIncidents30d}</b> more in 30 days (constant-hazard projection).
            </div>
          </>
        )}
      </div>

      {warehouses.length > 0 && (
        <div className="card">
          <h3>
            Blast radius
            <span className="tag">units / incidents</span>
          </h3>
          <div className="bars">
            {warehouses.map((w) => (
              <div className="bar-row" key={w.warehouse_id} style={{ gridTemplateColumns: '96px 1fr 64px' }}>
                <span className="muted">{w.region}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(w.units / warehouses[0].units) * 100}%`, background: 'var(--signal)' }} />
                </div>
                <span className="mono faint" style={{ textAlign: 'right' }}>
                  {w.units} / {w.failures}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>
          Evidence gate
          {gate && <span className={`tag ${gate.pass ? 'good' : 'bad'}`}>{gate.pass ? 'action allowed' : 'action blocked'}</span>}
        </h3>
        {!gate ? (
          <div className="empty">Traceon refuses to act until every criterion is met.</div>
        ) : (
          <ul className="criteria">
            {gate.criteria.map((c) => (
              <li key={c.id}>
                <span className={c.pass ? 'good' : 'bad'}>{c.pass ? '✓' : '✗'}</span>
                <span>{c.label}</span>
                <span className="d">{c.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {gate?.pass && a && (
        <div className="card approve">
          <h3>Human approval</h3>
          {!result ? (
            <>
              <input placeholder="Approver name (e.g. VP Quality)" value={approver} onChange={(e) => setApprover(e.target.value)} />
              <button className="btn danger" disabled={!approver.trim() || busy || state.running} onClick={execute}>
                {busy ? 'Executing…' : `Execute remediation · ${a.causes.map((c) => `${REMEDY_LABEL[c.remedy].toLowerCase()} ${c.units.toLocaleString('en-US')}`).join(' + ')}`}
              </button>
              {err && <div className="bad" style={{ marginTop: 6 }}>{err}</div>}
            </>
          ) : (
            <>
              <div style={{ font: '500 19px/1.3 var(--serif)', color: 'var(--signal)' }}>
                {result.alreadyQuarantined ? 'Already in place' : 'Remediation executed'} · {result.holdId}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {result.unitsHeld > 0 && `${result.erpHoldRowCount.toLocaleString('en-US')} serials set to BLOCKED_STOCK across ${result.warehouses.length} warehouses. `}
                {result.otherActions.map((o) => `${o.label}: ${o.units.toLocaleString('en-US')} units (${o.jobId}). `).join('')}
                Finding committed to H-MEM long-term memory ({result.memoryInsightId}).
              </div>
              <div className="tabs" style={{ flexWrap: 'wrap' }}>
                {Object.keys(result.notices).map((k) => (
                  <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                    {NOTICE_TITLES[k] ?? k}
                  </button>
                ))}
                <button style={{ marginLeft: 'auto' }} onClick={() => download(`${result.holdId}-${tab}.txt`, result.notices[tab] ?? '', 'text/plain')}>
                  Download
                </button>
              </div>
              <pre className="notice">{result.notices[tab]}</pre>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h3>
          Proof ledger
          {state.ledger && <span className="tag">{state.ledger.count} items</span>}
        </h3>
        {!state.ledger ? (
          <div className="empty">Every query, test and model output is hashed into an append-only chain.</div>
        ) : (
          <>
            <div className="faint" style={{ fontSize: 11 }}>Chain root</div>
            <div className="hash">{state.ledger.root}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn small" style={{ flex: 1 }} onClick={runVerify} disabled={verifying || state.running}>
                {verifying ? 'Replaying…' : 'Replay & verify'}
              </button>
              <button className="btn small" style={{ flex: 1 }} onClick={() => download(`traceon-proof-${state.ledger!.root.slice(0, 8)}.json`, bundle())}>
                Export proof bundle
              </button>
            </div>
            {verify && (
              <div className={verify.ok ? 'good' : 'bad'} style={{ fontSize: 12, marginTop: 8 }}>
                {verify.ok
                  ? `Verified. Re-executed ${verify.replayedQueries} SQL queries; every hash and the chain root match.`
                  : `Verification failed for ${verify.mismatches.length} item(s): ${verify.mismatches.map((m) => m.id).join(', ')}`}
              </div>
            )}
            {err && !gate?.pass && <div className="bad" style={{ marginTop: 6, fontSize: 12 }}>{err}</div>}
          </>
        )}
      </div>
    </aside>
  );
}

function mergeWarehouses(rows: { warehouse_id: string; region: string; units: number; failures: number }[]) {
  const m = new Map<string, { warehouse_id: string; region: string; units: number; failures: number }>();
  for (const r of rows) {
    const cur = m.get(r.warehouse_id) ?? { ...r, units: 0, failures: 0 };
    cur.units += r.units;
    cur.failures += r.failures;
    m.set(r.warehouse_id, cur);
  }
  return [...m.values()].sort((a, b) => b.units - a.units);
}
