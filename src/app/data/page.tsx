'use client';
// Bring your own data: upload a CSV (one row per unit), say which column
// records a failure and which columns are suspects, and investigate it with
// the same agent, tests and evidence gate as the demo.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SiteHeader } from '@/components/AppNav';

interface Profile {
  columns: string[];
  rowCount: number;
  preview: string[][];
  profile: { name: string; distinct: number; top: [string, number][] }[];
}
interface Listed {
  id: string;
  name: string;
  createdAt: string;
  rows: number;
  factors: string[];
}

/**
 * Bundled datasets, each with the mapping that fits it. The first is real.
 * The server never evicts them: their ids at the default cost are pinned in
 * SAMPLE_IDS (datasets.ts), so a change to a mapping needs a new id there.
 */
const SAMPLES = [
  {
    id: 'backblaze',
    file: '/samples/backblaze-drives-q2-2026.csv',
    label: 'Real data: Backblaze hard drives, Q2 2026',
    note: 'Every drive in Backblaze’s fleet for one quarter (public Drive Stats data): which models failed, against data centre and age.',
    // The suspects of README Example 3, as ./sample.sh runs it.
    mapping: { outcome: 'failed', failValues: ['yes'], factors: ['model', 'datacenter', 'age_band'], serial: 'serial', date: 'failure_date', symptom: '', daysInField: 'days_in_field' },
  },
  {
    id: 'charger',
    file: '/samples/charger-returns.csv',
    label: 'Generated: 12,000 USB-C chargers',
    note: 'A generated dataset with a planted bad resin lot and a night-shift confounder.',
    mapping: { outcome: 'returned', failValues: ['yes'], factors: ['resin_lot', 'mold_cavity', 'shift', 'line', 'region'], serial: 'serial', date: 'failure_date', symptom: 'symptom', daysInField: 'days_in_field' },
  },
] as const;
const FAILISH = /^(1|y|yes|true|fail|failed|returned|defect|defective|claim)$/i;

export default function DataPage() {
  const [csv, setCsv] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [prof, setProf] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [failValues, setFailValues] = useState<string[]>([]);
  const [factors, setFactors] = useState<string[]>([]);
  const [opt, setOpt] = useState({ serial: '', date: '', symptom: '', daysInField: '' });
  const [unitCost, setUnitCost] = useState('25');
  const [listed, setListed] = useState<Listed[]>([]);
  const [cap, setCap] = useState(50);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/datasets')
      .then((r) => r.json())
      .then((d) => (setListed(d.datasets ?? []), d.limits?.maxDatasets && setCap(d.limits.maxDatasets)))
      .catch(() => {});
  }, []);

  const load = async (text: string, fileName: string, preset?: (typeof SAMPLES)[number]['mapping']) => {
    setErr(null);
    setBusy(true);
    setCsv(text);
    setName(fileName.replace(/\.csv$/i, ''));
    try {
      const r = await fetch('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: text }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setProf(d);
      if (preset) {
        setOutcome(preset.outcome);
        setFailValues([...preset.failValues]);
        setFactors([...preset.factors]);
        setOpt({ serial: preset.serial, date: preset.date, symptom: preset.symptom, daysInField: preset.daysInField });
      } else guess(d);
    } catch (e) {
      setErr((e as Error).message);
      setProf(null);
    } finally {
      setBusy(false);
    }
  };

  /** A first guess at the mapping; everything stays editable. */
  const guess = (p: Profile) => {
    const by = (re: RegExp) => p.profile.find((c) => re.test(c.name))?.name ?? '';
    const out = p.profile.find((c) => c.distinct === 2 && c.top.some(([v]) => FAILISH.test(v)))?.name ?? by(/fail|return|defect|claim|outcome/i);
    setOutcome(out);
    const oc = p.profile.find((c) => c.name === out);
    setFailValues(oc ? oc.top.map(([v]) => v).filter((v) => FAILISH.test(v)) : []);
    const o = { serial: by(/serial|unit.?id|^id$/i), date: by(/fail.*date|claim.*date|date.*fail/i), symptom: by(/symptom|description|complaint|narrative|reason/i), daysInField: by(/days.?in.?field|age.?days|days$/i) };
    setOpt(o);
    const used = new Set([out, ...Object.values(o)]);
    setFactors(p.profile.filter((c) => !used.has(c.name) && c.distinct >= 2 && c.distinct <= 60 && !/date/i.test(c.name)).map((c) => c.name).slice(0, 12));
  };

  const outcomeCol = prof?.profile.find((c) => c.name === outcome);
  const failCount = useMemo(() => (outcomeCol ? outcomeCol.top.filter(([v]) => failValues.includes(v)).reduce((a, [, n]) => a + n, 0) : 0), [outcomeCol, failValues]);

  const submit = async () => {
    if (!csv) return;
    setBusy(true);
    setErr(null);
    try {
      const mapping = { outcome, failValues, factors, unitCost: Number(unitCost) || 0, ...Object.fromEntries(Object.entries(opt).filter(([, v]) => v)) };
      const r = await fetch('/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, name, mapping }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.href = `/app?scenario=${d.id}&autorun=1`;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 25e6) return setErr('File is larger than 25 MB');
    f.text().then((t) => load(t, f.name));
  };

  return (
    <div className="page">
      <SiteHeader subtitle="Your data · bring a CSV" />
      <div className="page-body">
        <div className="page-head">
          <div className="kicker">Bring your own data</div>
          <h1>Investigate your own failures.</h1>
          <p>
            One row per unit, a column that says which units failed, and the columns you suspect: supplier, lot, plant, line, firmware, region. The agent screens every factor, rules out confounders, proves the cause and scopes the exact units, with the same statistics and evidence gate as the demo. Optional columns (failure date, symptom text, days in field, serial) unlock more checks.
          </p>
        </div>

        {!prof ? (
          <>
            <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="visually-hidden" tabIndex={-1} />
            {/* A focusable button, so the file chooser opens from the keyboard too (Enter or Space). */}
            <div
              className={`drop ${over ? 'over' : ''}`}
              role="button"
              tabIndex={0}
              aria-labelledby="drop-label"
              aria-describedby="drop-note"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.current?.click())}
              onDragOver={(e) => (e.preventDefault(), setOver(true))}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => (e.preventDefault(), setOver(false), onFile(e.dataTransfer.files[0]))}
            >
              <div id="drop-label" style={{ font: '500 20px/1.3 var(--serif)' }}>{busy ? 'Reading…' : 'Drop a CSV here, or click to choose one'}</div>
              <div id="drop-note" className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                Up to 400,000 rows and 25 MB. The file is stored on this server, where every statistic is computed. The AI model is sent the record count and date range, the factor names and their values, the test results, and each confirmed cause’s most common symptom word; never serials or record text. Every upload is listed on this page, and by GET /api/datasets, for every visitor.
              </div>
            </div>
            <div className="samples">
              {SAMPLES.map((smp) => (
                <div key={smp.id} className="sample-row">
                  <div>
                    <b>{smp.label}</b>
                    <div className="faint" style={{ fontSize: 12 }}>{smp.note}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <button className="btn small" onClick={() => (setBusy(true), fetch(smp.file).then((r) => r.text()).then((t) => load(t, smp.file.split('/').pop()!, smp.mapping)))} disabled={busy}>
                      Use it
                    </button>
                    <a className="btn ghost small" href={smp.file} download>
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="sheet-box">
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 }}>
              <label className="field" style={{ flex: '1 1 260px' }}>
                <span>Dataset name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </label>
              <span className="mono faint">
                {prof.rowCount.toLocaleString('en-US')} rows · {prof.columns.length} columns
              </span>
              <button className="btn ghost small" onClick={() => (setProf(null), setCsv(null))}>
                Choose another file
              </button>
            </div>

            <div className="table-wrap" style={{ maxHeight: 220, marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    {prof.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {prof.preview.map((r, i) => (
                    <tr key={i}>
                      {prof.columns.map((c, j) => (
                        <td key={c} className="mono" style={{ whiteSpace: 'nowrap' }}>
                          {r[j]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid2">
              <div className="card">
                <h3>Outcome</h3>
                <label className="field">
                  <span>Column that records a failure</span>
                  <select value={outcome} onChange={(e) => (setOutcome(e.target.value), setFailValues([]))}>
                    <option value="">Choose…</option>
                    {prof.columns.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                {outcomeCol && (
                  <div style={{ marginTop: 10 }}>
                    <div className="lbl-mono">Values that mean “failed”</div>
                    <div className="checks">
                      {outcomeCol.top.map(([v, n]) => (
                        <label key={v}>
                          <input type="checkbox" checked={failValues.includes(v)} onChange={(e) => setFailValues((f) => (e.target.checked ? [...f, v] : f.filter((x) => x !== v)))} />
                          <span className="mono">{v || '(blank)'}</span> <span className="faint">{n.toLocaleString('en-US')}</span>
                        </label>
                      ))}
                    </div>
                    <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>{failCount.toLocaleString('en-US')} failed units</div>
                  </div>
                )}
              </div>
              <div className="card">
                <h3>Suspects to test</h3>
                <div className="checks">
                  {prof.profile
                    .filter((c) => c.name !== outcome)
                    .map((c) => (
                      <label key={c.name} title={`${c.distinct} distinct values`}>
                        <input type="checkbox" checked={factors.includes(c.name)} disabled={c.distinct < 2 || c.distinct > 500} onChange={(e) => setFactors((f) => (e.target.checked ? [...f, c.name] : f.filter((x) => x !== c.name)))} />
                        {c.name} <span className="faint mono">{c.distinct}</span>
                      </label>
                    ))}
                </div>
                <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Categorical columns with 2 to 500 values; up to 12. The multiple-testing bar tightens with each one.</div>
              </div>
              <div className="card">
                <h3>Optional columns</h3>
                {(
                  [
                    ['serial', 'Serial number', 'exact units to hold'],
                    ['date', 'Failure date (YYYY-MM-DD)', 'early-warning replay'],
                    ['symptom', 'Symptom text', 'failure-signature check'],
                    ['daysInField', 'Days in field', 'exposure-time check'],
                  ] as const
                ).map(([k, label, why]) => (
                  <label key={k} className="field" style={{ marginBottom: 8 }}>
                    <span>
                      {label} · {why}
                    </span>
                    <select value={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.value })}>
                      <option value="">none</option>
                      {prof.columns.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="card">
                <h3>Investigate</h3>
                <label className="field" style={{ marginBottom: 10 }}>
                  <span>Cost to hold one unit (USD) · logistics, replacement, handling</span>
                  <input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </label>
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  {factors.length} suspect{factors.length === 1 ? '' : 's'}, {failCount.toLocaleString('en-US')} failures in {prof.rowCount.toLocaleString('en-US')} units. Checks without their column are marked N/A in the evidence gate rather than passed.
                </p>
                <button className="btn primary" onClick={submit} disabled={busy || !outcome || !failValues.length || !factors.length}>
                  {busy ? 'Saving…' : 'Open the case file'}
                </button>
              </div>
            </div>
          </div>
        )}
        {err && <div className="bad" style={{ marginTop: 10 }}>{err}</div>}

        {listed.length > 0 && (
          <div className="card" style={{ marginTop: 26 }}>
            <h3>Datasets on this server</h3>
            <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
              The server keeps {cap} uploads; past that, each new one replaces the oldest. The two samples always stay.
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Rows</th>
                    <th>Suspects</th>
                    <th>Uploaded</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listed.map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td>{d.rows.toLocaleString('en-US')}</td>
                      <td className="faint">{d.factors.join(', ')}</td>
                      <td className="mono">{d.createdAt.slice(0, 10)}</td>
                      <td>
                        <a href={`/app?scenario=${d.id}&autorun=1`}>Investigate</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
