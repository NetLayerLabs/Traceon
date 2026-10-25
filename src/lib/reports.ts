// Printable documents generated from a finished case. Every figure comes from
// the case's own events, and every claim cites the exhibit that holds it, so
// a document can be checked against the proof ledger line by line.
//   - Supplier dispute packet: the chargeback case against a supplier.
//   - 8D report: the standard automotive/industrial problem-solving format.
import type { CaseView } from './caseView';
import { PRODUCT_NAME, SKU, UNIT_COST_USD } from './enterpriseData';
import type { CauseFinding, EvidenceItem } from './investigation';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const n = (x: number) => x.toLocaleString('en-US');
const usd = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;
const rate = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)}/10k`;

function exhibit(view: CaseView, label: RegExp | string): EvidenceItem | undefined {
  return view.evidence.find((e) => (typeof label === 'string' ? e.label === label : label.test(e.label)));
}
const cite = (e?: EvidenceItem) => (e ? ` <span class="cite">[${e.id}]</span>` : '');

function page(title: string, subtitle: string, view: CaseView, body: string) {
  const issued = new Date().toISOString().slice(0, 10);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap" rel="stylesheet">
<style>
:root{--paper:#F2EFE7;--sheet:#FAF8F3;--ink:#1A1714;--muted:#5E574E;--rule:#D9D3C6;--signal:#C23D17;--ok:#2C6A4C;--ochre:#94660F}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 'IBM Plex Sans',system-ui,sans-serif}
.sheet{max-width:860px;margin:32px auto;background:var(--sheet);border:1px solid var(--rule);padding:48px 56px}
h1{font:600 30px/1.15 Newsreader,Georgia,serif;margin:0 0 4px}h2{font:600 19px/1.3 Newsreader,Georgia,serif;margin:30px 0 8px;padding-top:14px;border-top:1px solid var(--rule)}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:18px 0 6px}
.meta{font:12px 'IBM Plex Mono',monospace;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 18px;margin:12px 0 0}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-weight:600;font-size:12px;color:var(--muted)}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.mono,.cite{font-family:'IBM Plex Mono',monospace;font-size:12px}.cite{color:var(--signal)}
.stamp{display:inline-block;border:2px solid var(--signal);color:var(--signal);font:600 12px 'IBM Plex Mono',monospace;padding:3px 8px;letter-spacing:.08em;transform:rotate(-2deg)}
.ok{color:var(--ok)}.bad{color:var(--signal)}.confounder{color:var(--ochre)}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px}.sign div{border-top:1px solid var(--ink);padding-top:6px;font-size:12px;color:var(--muted)}
.toolbar{max-width:860px;margin:16px auto 0;display:flex;justify-content:flex-end;gap:8px}
.toolbar button{font:500 13px 'IBM Plex Sans';background:var(--ink);color:var(--sheet);border:0;padding:8px 14px;cursor:pointer}
@media (max-width:700px){.sheet{margin:0;padding:24px 16px;border:0}.sign{grid-template-columns:1fr}table{font-size:12px}}
@media print{body{background:#fff}.sheet{margin:0;border:0;padding:0;max-width:none}.toolbar{display:none}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print or save as PDF</button></div>
<main class="sheet">
<span class="stamp">${esc(subtitle)}</span>
<h1>${esc(title)}</h1>
<div class="meta"><span>Product: ${esc(view.scenario?.id.startsWith('custom-') ? view.scenario.label : `${PRODUCT_NAME} (${SKU})`)}</span><span>Issued: ${issued}</span><span>Proof root: ${esc(view.ledger?.root.slice(0, 16))}…</span><span>Exhibits: ${view.ledger?.count ?? view.evidence.length}</span></div>
${body}
<h2>Verification</h2>
<p>Every exhibit cited as <span class="cite">[E-nn]</span> is in the Traceon proof ledger. Each SQL exhibit can be re-run against the source systems and must reproduce its SHA-256 hash; the chain of hashes ends at the root below.</p>
<p class="mono">${esc(view.ledger?.root)}</p>
${appendix(view)}
</main></body></html>`;
}

function appendix(view: CaseView) {
  return `<h3>Exhibit index</h3><table><thead><tr><th>Exhibit</th><th>Kind</th><th>What it shows</th><th>Hash</th></tr></thead><tbody>${view.evidence
    .map((e) => `<tr><td class="mono">${e.id}</td><td>${esc(e.kind)}</td><td>${esc(e.label)}: ${esc(e.summary)}</td><td class="mono">${e.proofHash.slice(0, 12)}…</td></tr>`)
    .join('')}</tbody></table>`;
}

function ruledOut(view: CaseView, c: CauseFinding) {
  const node = view.hypotheses.find((h) => h.id === c.hypothesisId);
  const others = view.hypotheses.filter((h) => h.id !== c.hypothesisId && !view.action?.causes.some((x) => x.hypothesisId === h.id));
  const adj = (node?.adjusted ?? [])
    .map((a) => `<tr><td>${esc(a.controlLabel)}</td><td class="mono">${esc(a.pLabel)}</td><td class="num">${a.aliased ? 'aliased' : a.commonOddsRatio.toFixed(1)}</td></tr>`)
    .join('');
  return `<h3>Other explanations tested</h3>
<table><thead><tr><th>Suspect</th><th>Result</th><th>Why</th></tr></thead><tbody>${others
    .map(
      (h) =>
        `<tr><td>${esc(h.title)}</td><td class="${h.status === 'CONFOUNDED' ? 'confounder' : ''}">${h.status === 'CONFOUNDED' ? 'Confounder (ruled out)' : h.status === 'NO_ASSOCIATION' ? 'No association' : esc(h.status)}</td><td>${esc(h.verdict ?? '')}${h.evidenceIds.length ? ` <span class="cite">[${h.evidenceIds.slice(-1)[0]}]</span>` : ''}</td></tr>`
    )
    .join('')}</tbody></table>
${adj ? `<h3>${esc(c.group)} after controlling for each other factor (Cochran–Mantel–Haenszel)</h3><table><thead><tr><th>Controlled for</th><th>Adjusted p</th><th class="num">Common odds ratio</th></tr></thead><tbody>${adj}</tbody></table>` : ''}`;
}

function causeFacts(view: CaseView, c: CauseFinding) {
  const scope = exhibit(view, `Blast radius ${c.group}`) ?? exhibit(view, `BOM lineage join ${c.group}`);
  const screen = exhibit(view, `${c.hypothesisId} screen`);
  const coverage = exhibit(view, 'Combined coverage');
  const signature = exhibit(view, `Symptom concordance ${c.group}`);
  return `<table><tbody>
<tr><th>Cause</th><td>${esc(c.title)}: <b>${esc(c.column.replace(/^f_/, '').replace(/_/g, ' '))} = ${esc(c.group)}</b>${c.supplier ? ` (supplier ${esc(c.supplier)})` : ''}</td></tr>
<tr><th>Units in scope</th><td>${n(c.units)}${c.lots.length ? ` in ${c.lots.length} lot${c.lots.length > 1 ? 's' : ''}: ${c.lots.map((l) => `${esc(l.lot_id)} (SN-${l.serial_start} to SN-${l.serial_end}, built ${l.build_start} to ${l.build_end})`).join('; ')}` : ''}${cite(scope)}</td></tr>
<tr><th>Failures</th><td>${n(c.failures)} incidents; failure rate ${rate(c.ratePer10k)} (95% CI ${rate(c.rateCI.lo)} to ${rate(c.rateCI.hi)}) against ${rate(c.baseRatePer10k)} for all other units${cite(screen)}</td></tr>
<tr><th>Relative risk</th><td>${c.rr.rr.toFixed(1)}x (95% CI ${c.rr.lo.toFixed(1)} to ${c.rr.hi.toFixed(1)})</td></tr>
<tr><th>Share of all incidents</th><td>${(c.coverage * 100).toFixed(1)}% (95% CI ${(c.coverageCI.lo * 100).toFixed(1)}% to ${(c.coverageCI.hi * 100).toFixed(1)}%)${cite(coverage)}</td></tr>
${c.concordance.claims ? `<tr><th>Failure signature</th><td>${(c.concordance.share * 100).toFixed(0)}% of the ${n(c.concordance.claims)} claims in scope describe the same failure (${esc(c.concordance.family)})${cite(signature)}</td></tr>` : ''}
</tbody></table>`;
}

export function supplierPacket(view: CaseView): string {
  const causes = (view.action?.causes ?? []).filter((c) => c.remedy === 'QUARANTINE');
  if (!causes.length) throw new Error('No physical cause to dispute with a supplier');
  const body = causes
    .map((c) => {
      const supplier = c.supplier ?? (c.column.includes('supplier') ? c.group : 'the supplier of record');
      const perUnit = c.units ? c.costUsd / c.units : UNIT_COST_USD;
      const claim = c.costUsd;
      return `<h2>Claim against ${esc(supplier)}</h2>
<p>We hold that the parts identified below were defective when delivered, and that the defect caused the field incidents listed. The finding is statistical and was reached after every other recorded explanation was tested and excluded.</p>
${causeFacts(view, c)}
${ruledOut(view, c)}
${view.vision ? `<h3>Physical evidence</h3><p>${esc(view.vision.visualEvidenceSummary)} (failure mode: ${esc(view.vision.physicalFailureMode)}; component: ${esc(view.vision.suspectedComponent)})${cite(view.evidence.find((e) => e.kind === 'vision'))}</p>` : ''}
<h3>Amount claimed</h3>
<table><tbody><tr><th>Units quarantined</th><td class="num">${n(c.units)}</td></tr><tr><th>Cost per unit (logistics, replacement, handling)</th><td class="num">${usd(perUnit)}</td></tr><tr><th>Total</th><td class="num"><b>${usd(claim)}</b></td></tr></tbody></table>
<h3>Requested remedy</h3>
<p>Credit or replacement for the units above, the supplier's 8D response for the affected batch within 10 working days, and containment of any other material from the same batch.</p>`;
    })
    .join('');
  return page('Supplier dispute packet', 'SUPPLIER CLAIM', view, `${body}<div class="sign"><div>Supplier quality engineer</div><div>Supplier acknowledgement</div></div>`);
}

export function eightD(view: CaseView): string {
  const custom = Boolean(view.scenario?.id.startsWith('custom-'));
  const plan = view.action;
  const causes = plan?.causes ?? [];
  const gate = view.gate;
  const fals = causes.flatMap((c) => c.falsifiers.map((f) => ({ c, f })));
  const timeline = view.timeline;
  const body = `
<h2>D1. Team</h2>
<table><tbody><tr><th>Investigation</th><td>Traceon agent (Nemotron plans and explains; deterministic statistics decide)</td></tr><tr><th>Quality lead</th><td>&nbsp;</td></tr><tr><th>Supplier quality</th><td>&nbsp;</td></tr><tr><th>Field service</th><td>&nbsp;</td></tr></tbody></table>
<h2>D2. Problem description</h2>
<p>${esc(plan ? `${n(plan.incidentsSoFar)} ${custom ? 'failures' : 'thermal incidents'} explained among ${n(plan.blanketUnits)} units in the field.` : custom ? 'Failures recorded in the uploaded data.' : 'Thermal incidents reported in the field.')} ${esc(view.narrative?.text.split('\n')[0] ?? '')}</p>
<h2>D3. Containment</h2>
${plan ? `<p>${causes.map((c) => `${esc(c.remedy === 'QUARANTINE' ? 'Quarantine' : c.remedy.replace('_', ' ').toLowerCase())} of ${n(c.units)} units (${esc(c.column.replace(/_/g, ' '))} ${esc(c.group)})`).join('; ')}, instead of recalling all ${n(plan.blanketUnits)} units. Cost ${usd(plan.surgicalCostUsd)} against ${usd(plan.blanketCostUsd)} for a blanket recall. Without containment, about ${plan.projectedIncidents30d} more incidents are projected in 30 days (90% range ${plan.projectedRange.lo} to ${plan.projectedRange.hi}).</p>` : '<p>No containment: the evidence gate did not pass.</p>'}
<h2>D4. Root cause</h2>
${causes.map((c) => causeFacts(view, c) + ruledOut(view, c)).join('') || '<p>No root cause confirmed.</p>'}
${view.redteam ? `<h3>Challenges to the verdict</h3><table><thead><tr><th>Objection</th><th>Answer from the evidence</th></tr></thead><tbody>${view.redteam.objections.map((o) => `<tr><td>${esc(o.objection)}</td><td class="${o.survived ? 'ok' : 'bad'}">${esc(o.result)}</td></tr>`).join('')}</tbody></table>` : ''}
<h2>D5. Permanent corrective actions</h2>
${causes.length ? `<ul>${causes.map((c) => `<li>${c.remedy === 'OTA_ROLLBACK' ? `Roll back firmware ${esc(c.group)} and release a fixed version` : c.remedy === 'CARRIER_INSPECTION' ? `Inspect and requalify carrier ${esc(c.group)}` : c.remedy === 'QUARANTINE' ? `Reject the affected material (${esc(c.group)}) and require the supplier's corrective action` : `Customer advisory for ${esc(c.group)}`}</li>`).join('')}</ul>` : '<p>None.</p>'}
<h2>D6. Implement and validate</h2>
<p>The fix is validated if none of these pre-registered conditions occurs after it is applied:</p>
<table><thead><tr><th>Condition</th><th>Rule</th><th class="num">Now</th><th class="num">Threshold</th></tr></thead><tbody>${fals.map(({ f }) => `<tr><td>${esc(f.label)}</td><td>${esc(f.rule)}</td><td class="num">${f.current ?? 'n/a'}</td><td class="num">${f.threshold ?? 'n/a'}</td></tr>`).join('')}</tbody></table>
<h2>D7. Prevent recurrence</h2>
<p>${timeline?.alertDate ? `A daily screen of this kind would have raised the alert on ${esc(timeline.alertDate)}, after ${timeline.claimsAtAlert} claims; ${timeline.claimsAfterAlert} later claims could have been avoided.` : 'Add the factors tested here to the daily warranty screen.'} Keep the same factors under continuous watch, with the same multiple-testing bar.</p>
${gate ? `<h3>Evidence gate at closure</h3><table><tbody>${gate.criteria.map((c) => `<tr><td>${esc(c.label)}</td><td class="${c.na ? '' : c.pass ? 'ok' : 'bad'}">${c.na ? 'N/A' : c.pass ? 'Pass' : 'Fail'}</td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table>` : ''}
<h2>D8. Closure</h2>
<div class="sign"><div>Quality lead</div><div>Engineering manager</div></div>`;
  return page('8D problem-solving report', '8D REPORT', view, body);
}
