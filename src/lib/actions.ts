// Real-world actions: the remediation (ERP hold, OTA rollback, carrier
// inspection) and the proof replay.
import crypto from 'node:crypto';
import { AS_OF, getEnterpriseMesh, PRODUCT_NAME, SKU, UNIT_COST_USD } from './enterpriseData';
import { chainGenesis, chainStep, REMEDY } from './investigation';
import type { EvidenceItem, RemedyKind } from './investigation';
import { commitRootCauseInsight, convergeSignals, readWorldModel, updateWorldModel } from './meterless';
import { hashRows, mirrorExec, runFederatedQuery } from './zetaris';

// Only these columns can be targeted by an action; values are SQL-escaped.
const ACTIONABLE = new Set(['cell_batch', 'cell_supplier', 'plant_id', 'bms_supplier', 'firmware', 'carrier', 'climate_zone']);
const sqlStr = (v: string) => {
  // alasql reads \' as an escaped quote, so a backslash could end the literal early.
  if (/[\\\u0000-\u001f]/.test(v)) throw new Error('Values with backslashes or control characters cannot be targeted');
  return `'${v.replace(/'/g, "''")}'`;
};
// Uploaded factors are stored as f_<name>; notices use the name people know.
const factor = (column: string) => column.replace(/^f_/, '').replace(/_/g, ' ');

export interface RemediationCause {
  column: string;
  group: string;
  remedy: RemedyKind;
}

export interface RemediationRequest {
  scenario?: string;
  causes: RemediationCause[];
  approvedBy: string;
  ledgerRoot: string;
}

export async function executeRemediation(req: RemediationRequest) {
  const scenarioId = req.scenario || 'reference';
  const mesh = getEnterpriseMesh(scenarioId);
  for (const c of req.causes) {
    if (!ACTIONABLE.has(c.column) && !(mesh.custom && /^f_[a-z0-9_]+$/.test(c.column))) throw new Error(`Column ${c.column} is not actionable`);
    if (!REMEDY[c.remedy]) throw new Error(`Unknown remedy ${c.remedy}`);
  }
  const quarantine = req.causes.filter((c) => c.remedy === 'QUARANTINE');
  let holdId = `QH-${crypto.createHash('sha256').update(scenarioId + req.ledgerRoot + JSON.stringify(req.causes)).digest('hex').slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();

  // ---- Physical causes: ERP hold on exact serials ----
  let unitsHeld = 0;
  let holdQueryHash: string | null = null;
  let alreadyQuarantined = false;
  const byWarehouse = new Map<string, { region: string; units: number }>();
  const lotIds = new Set<string>();
  if (quarantine.length) {
    const where = quarantine.map((c) => `${c.column} = ${sqlStr(c.group)}`).join(' OR ');
    const units = await runFederatedQuery(`SELECT serial, lot_id, warehouse_id, region, failed\nFROM unit_fact\nWHERE ${where}`, ['unit_fact'], scenarioId);
    holdQueryHash = units.proofHash;
    unitsHeld = units.rowCount;
    for (const r of units.rows) {
      lotIds.add(String(r.lot_id));
      const cur = byWarehouse.get(String(r.warehouse_id)) ?? { region: String(r.region), units: 0 };
      cur.units++;
      byWarehouse.set(String(r.warehouse_id), cur);
    }
    // Stock already on hold, from this run or an earlier one with the same cause,
    // is reported under its existing hold and never held twice.
    const held = new Map((mirrorExec(scenarioId, 'SELECT serial, hold_id FROM erp_holds WHERE status = ?', ['BLOCKED_STOCK']) as { serial: unknown; hold_id: string }[]).map((r) => [String(r.serial), r.hold_id]));
    const toHold = units.rows.filter((r) => !held.has(String(r.serial)));
    alreadyQuarantined = units.rowCount > 0 && toHold.length === 0;
    if (alreadyQuarantined) holdId = held.get(String(units.rows[0].serial))!;
    else {
      const holds = toHold.map((r) => ({
        hold_id: holdId,
        serial: r.serial,
        lot_id: r.lot_id,
        warehouse_id: r.warehouse_id,
        reason: `Thermal defect: ${quarantine.map((c) => `${c.column}=${c.group}`).join(', ')}`,
        status: 'BLOCKED_STOCK',
        created_at: now,
        approved_by: req.approvedBy,
        evidence_root: req.ledgerRoot,
      }));
      mirrorExec(scenarioId, 'INSERT INTO erp_holds SELECT * FROM ?', [holds]);
    }
    const lots = mesh.lots.filter((l) => lotIds.has(l.lot_id));
    // A lot is marked quarantined only if the hold covers all of it.
    updateWorldModel(
      lots.map((l) => ({
        lotId: l.lot_id,
        signalCount: mesh.claims.filter((c) => c.lot_id === l.lot_id).length,
        anomalyScore: 100,
        status: 'QUARANTINED' as const,
        lastUpdated: now,
        note: `${holdId} approved by ${req.approvedBy}`,
      })),
      scenarioId
    );
  }

  // ---- Non-physical causes: OTA rollback / inspection / advisory ----
  const otherActions = [];
  for (const c of req.causes.filter((x) => x.remedy !== 'QUARANTINE')) {
    const res = await runFederatedQuery(`SELECT COUNT(*) AS units\nFROM unit_fact\nWHERE ${c.column} = ${sqlStr(c.group)}`, ['unit_fact'], scenarioId);
    const units = Number(res.rows[0]?.units ?? 0);
    otherActions.push({ ...c, label: REMEDY[c.remedy].label, units, costUsd: Math.round(units * REMEDY[c.remedy].costPerUnit), jobId: `${c.remedy === 'OTA_ROLLBACK' ? 'OTA' : c.remedy === 'CARRIER_INSPECTION' ? 'INSP' : 'ADV'}-${holdId.slice(3)}` });
  }

  // Human approval is the boundary at which the finding becomes long-term memory.
  const conv = convergeSignals('VR-48 pack hot overheat connector pin scorch burning smoke swelling charging', scenarioId);
  const insight = commitRootCauseInsight(
    `Root cause confirmed for ${SKU} thermal incidents: ${req.causes.map((c) => `${c.column} ${c.group} (${REMEDY[c.remedy].label})`).join('; ')}. Remediation ${holdId}.`,
    conv.matched.map((m) => m.id),
    scenarioId
  );

  const custom = Boolean(mesh.custom);
  const product = custom ? mesh.scenario.label : PRODUCT_NAME;
  const lots = mesh.lots.filter((l) => lotIds.has(l.lot_id));
  const serialRanges = custom ? `every unit with ${quarantine.map((c) => `${factor(c.column)} = ${c.group}`).join(' or ')}` : lots.length <= 4 ? lots.map((l) => `SN-${l.serial_start} through SN-${l.serial_end}`).join('; ') : `${lots.length} lots (${lots.map((l) => l.lot_id).join(', ')})`;
  const failuresHeld = quarantine.length ? mesh.units.filter((u) => u.failed && quarantine.some((c) => String((u as unknown as Record<string, unknown>)[c.column]) === c.group)).length : 0;
  const causeText = req.causes.map((c) => `${factor(c.column)} ${c.group}`).join(' and ');

  const notices: Record<string, string> = {};
  if (quarantine.length) {
    const locations = [...byWarehouse.entries()].filter(([wh]) => wh && wh !== 'undefined');
    notices.distributor = `URGENT: STOP SALE AND HOLD — ${product}
Hold reference: ${holdId}    Date: ${now.slice(0, 10)}

Effective immediately, place the following on hold and remove from sale:
  ${serialRanges}  (${unitsHeld.toLocaleString('en-US')} units)

No other ${custom ? '' : `${SKU} `}serials are affected by this hold. Do not pull unaffected stock.
${locations.length ? `Units per location:\n${locations.map(([wh, v]) => `  ${wh} (${v.region}): ${v.units} units`).join('\n')}\n` : ''}
Reason: ${quarantine.map((c) => `${factor(c.column)} ${c.group}`).join(', ')} ${custom ? 'is the confirmed cause of the recorded failures' : 'can overheat in use'}.
Evidence reference (proof root): ${req.ledgerRoot.slice(0, 16)}…`;
  }
  for (const a of otherActions) {
    notices[a.remedy === 'OTA_ROLLBACK' ? 'ota' : 'operations'] =
      a.remedy === 'OTA_ROLLBACK'
        ? `OTA ROLLBACK ORDER — ${product}
Job: ${a.jobId}    Date: ${now.slice(0, 10)}

Roll back firmware ${a.group} on ${a.units.toLocaleString('en-US')} connected packs to the previous stable release, and
apply a temporary 90% charge limit until a fixed release ships. Packs that are offline get the rollback on next connect.
No units need to be returned for this cause.
Evidence reference (proof root): ${req.ledgerRoot.slice(0, 16)}…`
        : `${a.label.toUpperCase()} ORDER — ${product}
Job: ${a.jobId}    Date: ${now.slice(0, 10)}

${a.label} for ${a.units.toLocaleString('en-US')} units (${factor(a.column)} ${a.group}).
Evidence reference (proof root): ${req.ledgerRoot.slice(0, 16)}…`;
  }
  notices.regulator = `DRAFT — Section 15(b) Report to the U.S. Consumer Product Safety Commission
(Prepared by Traceon for review by counsel before submission.)

Firm: ${custom ? '[your company]' : 'VoltRide (fictional demonstration company)'}
Product: ${custom ? product : `${PRODUCT_NAME}, model ${SKU}`}
Root cause: ${causeText}
${quarantine.length ? `Units held: ${unitsHeld.toLocaleString('en-US')} (${serialRanges})\nIncidents known in held population as of ${mesh.asOf ?? AS_OF}: ${failuresHeld}\n` : ''}${otherActions.map((a) => `${a.label}: ${a.units.toLocaleString('en-US')} units (${a.jobId})`).join('\n')}
Hazard: ${custom ? 'the failure mode recorded in the uploaded data (describe it here)' : 'thermal event in the battery pack (overheating, smoke, swelling, fire)'}
Corrective action: ${[quarantine.length ? `stop sale and quarantine (${holdId})` : '', ...otherActions.map((a) => `${a.label.replace(/^[A-Z](?=[a-z])/, (m) => m.toLowerCase())} (${a.jobId})`)].filter(Boolean).join('; ')}; consumer notification to follow.
Supporting evidence: Traceon proof ledger root ${req.ledgerRoot}`;

  return {
    holdId,
    alreadyQuarantined,
    unitsHeld,
    warehouses: [...byWarehouse.entries()].map(([warehouse_id, v]) => ({ warehouse_id, ...v })),
    otherActions,
    costUsd: unitsHeld * (mesh.unitCost ?? UNIT_COST_USD) + otherActions.reduce((a, x) => a + x.costUsd, 0),
    holdQueryHash,
    memoryInsightId: insight.id,
    notices,
    erpHoldRowCount: quarantine.length ? ((mirrorExec(scenarioId, 'SELECT COUNT(*) AS n FROM erp_holds WHERE hold_id = ?', [holdId]) as { n: number }[])[0]?.n ?? 0) : 0,
    worldModel: Object.values(readWorldModel(scenarioId)).filter((l) => l.status === 'QUARANTINED').map((l) => l.lotId),
  };
}

/** Re-run every SQL query in the ledger and rebuild the hash chain. */
export async function verifyLedger(items: EvidenceItem[], scenarioId = 'reference') {
  let head = chainGenesis(scenarioId);
  const results: { id: string; label: string; replayed: boolean; match: boolean; chainOk: boolean }[] = [];
  for (const it of items) {
    let replayed = false;
    let match = true;
    if (it.query?.sql) {
      replayed = true;
      try {
        const rerun = await runFederatedQuery(String(it.query.sql), Array.isArray(it.query.sourceSilos) ? it.query.sourceSilos : [], scenarioId);
        match = hashRows(it.query.sql, rerun.rows) === it.proofHash;
      } catch {
        match = false; // refused (not a read-only SELECT) or failed: it cannot be the agent's query
      }
    }
    head = chainStep(head, String(it.proofHash), String(it.label), String(it.summary ?? ''));
    results.push({ id: it.id, label: it.label, replayed, match, chainOk: head === it.chainHash });
  }
  return {
    root: head,
    replayedQueries: results.filter((r) => r.replayed).length,
    mismatches: results.filter((r) => !r.match || !r.chainOk),
    ok: results.every((r) => r.match && r.chainOk),
    results,
  };
}
