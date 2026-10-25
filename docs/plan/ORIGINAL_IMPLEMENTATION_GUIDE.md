# 🛠️ Traceon — Core Engines & Implementation Guide

This guide provides the production-ready TypeScript integration modules for **NVIDIA Nemotron 3.5 Super VL**, **Zetaris Cloud Data Harness (MCP/REST)**, **Meterless (`H-MEM` + `World Model` + `Markovian State`)**, and **Live Public Federal Safety APIs (`openFDA`, `NHTSA`, `CPSC`)** + **Bright Data**.

---

## 1. NVIDIA Nemotron Reasoning & Multimodal Defect Engine (`src/lib/nemotron.ts`)

Uses NVIDIA NIM (`https://integrate.api.nvidia.com/v1`) with `nvidia/nemotron-3.5-super-vl-120b-a12b` and `enable_thinking: true` to power both **Defect Photo Forensics** and **Hypothesis-Elimination Root-Cause Reasoning** (targeting the **`$4,699` NVIDIA DGX Spark** prize):

```typescript
// src/lib/nemotron.ts
import OpenAI from 'openai';

export const nemotronClient = new OpenAI({
  baseURL: process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY || '',
});

export const NEMOTRON_SUPER_VL =
  process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3.5-super-vl-120b-a12b';

export interface DefectPhotoAnalysis {
  physicalFailureMode: string;
  suspectedComponent: string;
  severityScore: number; // 0-100
  isManufacturingDefectLikely: boolean;
  visualEvidenceSummary: string;
}

/**
 * 1A. Multimodal Defect Photo Forensics (Nemotron 3.5 Super VL)
 */
export async function analyzeDefectImage(
  imageUrlOrBase64: string,
  productContext: string
): Promise<DefectPhotoAnalysis> {
  const completion = await nemotronClient.chat.completions.create({
    model: NEMOTRON_SUPER_VL,
    temperature: 0.2,
    max_tokens: 2048,
    // @ts-expect-error NVIDIA NIM custom thinking parameter
    extra_body: { chat_template_kwargs: { enable_thinking: true } },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are Traceon's Forensic Hardware & Product Safety Vision Inspector.
Product Context: ${productContext}
Inspect this customer-submitted defect image and output ONLY valid JSON:
{
  "physicalFailureMode": "exact physical failure mechanism observed",
  "suspectedComponent": "specific part, weld, seal, or connector pin",
  "severityScore": 0-100,
  "isManufacturingDefectLikely": true | false,
  "visualEvidenceSummary": "concise forensic description citing visual cues"
}`,
          },
          {
            type: 'image_url',
            image_url: { url: imageUrlOrBase64 },
          },
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
}

/**
 * 1B. Hypothesis-Elimination Root-Cause Investigator ("Explain Why")
 */
export interface HypothesisVerdict {
  id: string;
  title: string;
  status: 'CONFIRMED_ROOT_CAUSE' | 'RULED_OUT';
  confidencePct: number;
  pValueEstimate: number;
  sqlExecuted: string;
  whyExplanation: string;
  evidenceCitations: string[];
}

export async function synthesizeCausalVerdict(params: {
  incidentClusterSummary: string;
  memoryContextFromMeterless: string;
  zetarisQueryResults: Array<{ hypothesis: string; sql: string; rows: unknown[]; rowHash: string }>;
  visionFindings?: DefectPhotoAnalysis;
}): Promise<{
  rootCauseLotId: string;
  affectedUnitsCount: number;
  blanketRecallUnitsCount: number;
  estimatedSavingsUsd: number;
  hypotheses: HypothesisVerdict[];
  regulatorySummary: string;
}> {
  const completion = await nemotronClient.chat.completions.create({
    model: NEMOTRON_SUPER_VL,
    temperature: 0.2,
    max_tokens: 4096,
    // @ts-expect-error NVIDIA NIM custom thinking parameter
    extra_body: { chat_template_kwargs: { enable_thinking: true } },
    messages: [
      {
        role: 'system',
        content: `You are Traceon, an Explainable Root-Cause & Product Safety Investigation Agent.
Every conclusion MUST explain WHY competing hypotheses were ruled out and WHY the confirmed batch/lot is the root cause, citing exact SQL queries, row hashes, and regulatory report IDs. Never hallucinate numbers outside the provided federated query rows.`,
      },
      {
        role: 'user',
        content: JSON.stringify(params, null, 2) + `\n\nReturn ONLY valid JSON matching the Traceon Causal Verdict schema.`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
}
```

---

## 2. Zetaris Federated Data Harness & Row-Proof Adapter (`src/lib/zetaris.ts`)

Connects to **Zetaris Cloud Query Director / MCP** (`api.zetaris.app.com`) to execute zero-ETL federated SQL across fragmented enterprise tables (`erp_production_lots`, `supplier_component_boms`, `warehouse_shipments`, `firmware_telemetry`) and computes cryptographic SHA-256 row hashes so every node in the "Explain Why" graph is provably grounded:

```typescript
// src/lib/zetaris.ts
import crypto from 'crypto';

export interface FederatedQueryResult {
  sql: string;
  sourceSilos: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  proofHash: string;
  latencyMs: number;
  executedVia: 'ZETARIS_CLOUD_MCP' | 'ZETARIS_LOCAL_FEDERATED_MIRROR';
}

export async function runZetarisFederatedQuery(
  sql: string,
  sourceSilos: string[],
  localFallbackExecutor?: (sql: string) => Promise<Record<string, unknown>[]>
): Promise<FederatedQueryResult> {
  const start = Date.now();
  const zetarisEndpoint = process.env.ZETARIS_API_URL; // e.g., https://api.zetaris.app.com/v1/query
  const zetarisToken = process.env.ZETARIS_ID_TOKEN;

  if (zetarisEndpoint && zetarisToken) {
    const res = await fetch(zetarisEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${zetarisToken}`,
      },
      body: JSON.stringify({ sql, catalog: 'traceon_enterprise_mesh' }),
    });

    if (res.ok) {
      const data = await res.json();
      const rows: Record<string, unknown>[] = data.rows || data.result || [];
      const proofHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(rows))
        .digest('hex')
        .slice(0, 16);

      return {
        sql,
        sourceSilos,
        rows,
        rowCount: rows.length,
        proofHash,
        latencyMs: Date.now() - start,
        executedVia: 'ZETARIS_CLOUD_MCP',
      };
    }
  }

  // Deterministic Local Federated Mirror (SQLite / DuckDB) for 100% reliable live demos
  const rows = localFallbackExecutor ? await localFallbackExecutor(sql) : [];
  const proofHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(rows))
    .digest('hex')
    .slice(0, 16);

  return {
    sql,
    sourceSilos,
    rows,
    rowCount: rows.length,
    proofHash,
    latencyMs: Date.now() - start,
    executedVia: 'ZETARIS_LOCAL_FEDERATED_MIRROR',
  };
}
```

---

## 3. Meterless Context Stack (`H-MEM` + `LotWorldModel` + `Markovian State`) (`src/lib/meterlessContext.ts`)

Leverages the **Meterless** architecture (`github.com/Meterless/Meterless`) to solve the `#1` reason standard agents fail at early-warning detection: **stateless amnesia and context rot**.

```typescript
// src/lib/meterlessContext.ts
export interface EpisodicDefectSignal {
  id: string;
  source: 'OPENFDA' | 'NHTSA' | 'CPSC' | 'BRIGHTDATA_REVIEWS' | 'WARRANTY_UPLOAD';
  sku: string;
  serialOrLotHint?: string;
  symptomTags: string[];
  region: string;
  timestamp: string;
  rawExcerpt: string;
}

export interface LotRiskWorldState {
  lotId: string;
  sku: string;
  plantId: string;
  supplierBatchId: string;
  signalCount: number;
  convergedSymptoms: string[];
  anomalyScore: number; // 0-100
  quarantineStatus: 'ACTIVE' | 'INVESTIGATING' | 'QUARANTINED';
  lastUpdated: string;
}

/**
 * Meterless Local-First Context Harness:
 * 1. H-MEM: Compounds isolated episodic defect complaints into semantic lot-level clusters.
 * 2. World Model: Maintains live quarantine & anomaly risk state per Batch Lot.
 * 3. Markovian State Summary: Bounds multi-step investigation state to O(1) prompt size.
 */
export class TraceonMeterlessHarness {
  private episodicStore: EpisodicDefectSignal[] = [];
  private lotWorldModel: Map<string, LotRiskWorldState> = new Map();
  private markovianStepState: string = 'IDLE: No active investigation.';

  ingestSignal(signal: EpisodicDefectSignal, mappedLot?: Omit<LotRiskWorldState, 'signalCount' | 'convergedSymptoms' | 'anomalyScore' | 'quarantineStatus' | 'lastUpdated'>) {
    this.episodicStore.push(signal);

    if (mappedLot) {
      const existing = this.lotWorldModel.get(mappedLot.lotId);
      const mergedSymptoms = Array.from(
        new Set([...(existing?.convergedSymptoms || []), ...signal.symptomTags])
      );
      const nextCount = (existing?.signalCount || 0) + 1;
      const anomalyScore = Math.min(99, nextCount * 14 + mergedSymptoms.length * 8);

      this.lotWorldModel.set(mappedLot.lotId, {
        ...mappedLot,
        signalCount: nextCount,
        convergedSymptoms: mergedSymptoms,
        anomalyScore,
        quarantineStatus: existing?.quarantineStatus || (anomalyScore >= 65 ? 'INVESTIGATING' : 'ACTIVE'),
        lastUpdated: new Date().toISOString(),
      });
    }
  }

  advanceMarkovianInvestigationState(stepSummary: string, ruledOutHypotheses: string[], activeLead: string) {
    // Bounded O(1) Markovian transition — prevents context window bloat across 15+ SQL tool calls
    this.markovianStepState = JSON.stringify({
      updatedAt: new Date().toISOString(),
      currentFocus: activeLead,
      prunedBranches: ruledOutHypotheses,
      latestTransition: stepSummary,
    });
    return this.markovianStepState;
  }

  getCompoundedContextForSku(sku: string) {
    const relevantSignals = this.episodicStore.filter((s) => s.sku === sku).slice(-15);
    const lotStates = Array.from(this.lotWorldModel.values()).filter((l) => l.sku === sku);
    return {
      markovianState: this.markovianStepState,
      lotWorldStates: lotStates,
      recentEpisodicSignals: relevantSignals,
    };
  }

  markLotQuarantined(lotId: string) {
    const lot = this.lotWorldModel.get(lotId);
    if (lot) {
      lot.quarantineStatus = 'QUARANTINED';
      lot.lastUpdated = new Date().toISOString();
    }
  }
}
```

---

## 4. Live Public Federal Safety Feeds (`openFDA`, `NHTSA`, `CPSC`) (`src/lib/publicSafetyFeeds.ts`)

Zero-auth, real-time U.S. government adverse-event APIs so judges see **100% real live federal safety filings** streaming into Traceon right away:

```typescript
// src/lib/publicSafetyFeeds.ts
export async function fetchLiveOpenFdaDeviceEvents(searchQuery = 'battery+OR+overheat', limit = 10) {
  const url = `https://api.fda.gov/device/event.json?search=mdr_text.text:${searchQuery}&limit=${limit}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const data = await res.json();

  return (data.results || []).map((item: any) => ({
    reportId: item.report_number || item.mdr_report_key,
    source: 'openFDA MAUDE',
    dateReceived: item.date_received,
    brandName: item.device?.[0]?.brand_name || 'Unknown Device',
    manufacturer: item.device?.[0]?.manufacturer_d_name || 'Unknown Manufacturer',
    lotNumber: item.device?.[0]?.lot_number || null,
    eventType: item.event_type,
    narrative: item.mdr_text?.[0]?.text?.slice(0, 360) || '',
  }));
}

export async function fetchLiveCpscRecalls(limit = 10) {
  const url = 'https://www.saferproducts.gov/RestWebServices/Recall?format=json';
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) return [];
  const data = await res.json();

  return (data || []).slice(0, limit).map((item: any) => ({
    recallId: item.RecallNumber,
    source: 'CPSC SaferProducts',
    date: item.RecallDate,
    title: item.Title,
    description: item.Description?.slice(0, 320),
    hazards: (item.Hazards || []).map((h: any) => h.Name),
  }));
}

export async function fetchLiveNhtsaComplaints(make = 'TESLA', model = 'MODEL 3', modelYear = '2025') {
  const url = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(
    make
  )}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(modelYear)}`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) return [];
  const data = await res.json();

  return (data.results || []).slice(0, 10).map((item: any) => ({
    odiNumber: item.odiNumber,
    source: 'NHTSA ODI',
    dateComplaintFiled: item.dateComplaintFiled,
    components: item.components,
    crash: item.crash,
    fire: item.fire,
    summary: item.summary?.slice(0, 360) || '',
  }));
}
```

---

## 5. Fast 4-Day Execution Sprint (Oct 23 $\rightarrow$ Oct 27, 23:45 UTC)

* **Day 1 (Scaffold + Live Data + Federated Schema):**
  * Initialize Next.js 14 (App Router, TypeScript, Tailwind CSS, React Flow / Framer Motion) inside `/Users/mrnetwork/Traceon`.
  * Pull Meterless reference engine (`npx degit meterless/meterless/engines/hmem ./vendor/meterless-hmem`).
  * Seed realistic fragmented enterprise tables (`erp_production_lots`, `supplier_component_boms`, `warehouse_shipments`, `firmware_telemetry`) connected to `ZetarisFederationClient` + wire live `openFDA`, `NHTSA`, and `CPSC` APIs.
* **Day 2 (NVIDIA Nemotron 3.5 Super VL Reasoning + Vision Pipeline):**
  * Configure `NVIDIA_API_KEY` from `build.nvidia.com`.
  * Build `/api/investigate` (streaming multi-hypothesis SQL test loop + Meterless Markovian state updates) and `/api/vision-forensics` (`nemotron-3.5-super-vl-120b-a12b` physical defect analyzer).
* **Day 3 (3-Pane Forensic Command Center UI):**
  * Build `SignalStreamPane.tsx` (Left), `CausalDagCanvas.tsx` with clickable SQL Row-Proof & FDA Citation Modals (Center), and `SurgicalQuarantinePane.tsx` with `$` Recall Savings Calculator & 1-Click ERP Lot Hold + Regulatory Notice PDF/Markdown export (Right).
* **Day 4 (Deploy, Polish & 2-Minute Winning Demo Video):**
  * Deploy live URL to Vercel / Railway.
  * Record a crisp, high-impact demo video explicitly showcasing:
    1. **Track 02 Alignment:** How Traceon investigates across 4 fragmented silos and proves *why* 3 innocent hypotheses are false before isolating Batch `#L-409`.
    2. **Sponsor Tech:** Live calls to **NVIDIA Nemotron 3.5 Super VL (`thinking=true`)**, **Zetaris Federated SQL/MCP**, **Meterless (`H-MEM` + `World Model`)**, and **Bright Data / openFDA**.
    3. **Real Work Executed:** 1-click surgical quarantine saving `$4.46M` over a blanket product recall.
