# Traceon architecture

This document describes the code as it is. File paths point to where each piece lives. The [README](README.md) is the short version for judges.

## 1. The big picture

```mermaid
flowchart LR
  SRC["Signal sources<br/>warranty · web · CPSC, FDA, NHTSA"] --> SIG["Ingest + H-MEM<br/>signals.ts · meterless.ts"]
  SIG --> AG["Investigation agent<br/>investigation.ts + stats.ts"]
  AG --> GATE{"Evidence gate<br/>7 criteria"}
  GATE -- "pass + named approver" --> ACT["Remediation<br/>actions.ts"]
  GATE -- "blocked" --> MON["Monitor<br/>no recall"]
  AG <-- "plan, red team, questions, explain" --> NS["Meterless Nightshift<br/>Nemotron Lightning · Ultra"]
  AG -. "photo, fallback, hosted site" .-> NIM["NVIDIA NIM<br/>Nemotron Super VL · Lightning"]
  AG -- "SQL" --> ZET["Zetaris SQL API"]
  AG -. "fallback" .-> MIR[("Local mirror<br/>alasql")]
  AG -- "every result" --> PROOF["Proof chain<br/>SHA-256"]
  SIG <--> DISK[(".meterless-data")]
  ACT -- "ERP holds" --> MIR
  ACT -- "approved insight" --> DISK
```

**One process, three kinds of state.** Durable memory (H-MEM records, the trust ledger and the lot world model) lives on disk under `METERLESS_STORAGE_DIR`. The federated mirror, the ERP hold table and the run registry live in process memory, pinned to `globalThis` by `src/lib/singleton.ts` so every route bundle sees the same objects. The Nemotron reply cache lives in `.nim-cache/`. That is why the app wants one long-running Node host rather than serverless functions.

## 2. Data and scenarios

`src/lib/enterpriseData.ts` generates a fictional battery maker, **VoltRide**, and its VR-48 48V e-bike pack:

| Table | Rows | Silo it stands for |
| --- | --- | --- |
| `erp_production_lots` | 60 | ERP and plant manufacturing execution system |
| `supplier_bom_lineage` | 60 | Supplier portal (bill of materials) |
| `unit_fact` | 180,000 | Federated view: ERP x BOM x firmware telemetry x warehouse |
| `warranty_claims` | depends on scenario (125 in the reference) | Service cloud |
| `warehouses` | 7 | Warehouse management system |

Generation is seeded (`mulberry32(409)`), so the same scenario always produces identical rows. That is what makes proof hashes reproducible.

**Scenarios.** `resolveScenario()` turns an id into planted causes:

| Id | Planted cause | Built-in trap |
| --- | --- | --- |
| `reference` | Cell batch `CB-B-0917` in lot L-409 fails at 9% | L-409 shipped 72% to Sun Belt warehouses, so heat looks guilty; the batch's plant, supplier and BMS board look guilty too |
| `firmware` | Firmware v3.4 overcharges (rate 0.0018, ramps with time in field) | v3.4 rolled out first in the Sun Belt, so heat looks guilty |
| `two-causes` | The reference batch and firmware v3.4 together | Each cause inflates the other's baseline |
| `noise` | None; baseline rate 0.0006 | About 100 complaints with no structure |
| `random-<seed>` | Drawn from batch, firmware, plant, carrier, BMS board, two causes or none | The description stays hidden until the verdict |
| `<id>@YYYY-MM-DD` | Any of the above, as it stood on that date | Only units shipped and claims filed by then exist; time in field is recomputed. Watch mode opens cases with these ids. A planted cause whose units had not shipped yet is not counted as truth |
| `custom-<12 hex>` | An uploaded CSV (`src/lib/datasets.ts`) | No known truth, so no reveal. The factors are the uploaded columns, renamed `f_<slug>` for SQL |

The reference scenario keeps its historical random stream and plant-to-supplier mapping, so its published numbers never move. Other scenarios assign suppliers independently of plants (`supplierFor()`), so a plant defect and a supplier defect are distinguishable. `scenarioTruth()` exposes the planted causes, and only `runInvestigation()`'s final `reveal` event reads it.

## 3. Signals and memory

```mermaid
flowchart LR
  F1["CPSC e-bike recalls"] --> RAD["Signal radar<br/>federal: context only"]
  F2["openFDA MAUDE"] --> RAD
  F3["NHTSA ODI<br/>EV battery fires"] --> RAD
  W["Warranty claims"] --> ING["ingestSignals()<br/>idempotent by source id"]
  B["Reviews and forums"] --> ING
  ING --> HM[("H-MEM store<br/>per scenario")]
  HM --> Q["convergeSignals()<br/>hybrid retrieval, topN 400"]
  Q --> CL["Incident cluster<br/>131 signals in the reference"]
```

- **Feeds** (`src/lib/signals.ts`): CPSC e-bike recalls since 2025; Bright Data Web Unlocker fetching current Google News on e-bike battery fires (deduplicated by headline, cached 30 minutes; real-world context only, never ingested into H-MEM); openFDA medical-device reports whose own narrative describes a lithium-battery fire, smoke, melting or thermal runaway (`isLithiumThermalEvent()`; full-text search alone also matches lithium heparin); NHTSA complaints for EVs with a known battery-fire history (Bolt EV 2017-19, Kona Electric 2019-20). NHTSA covers motor vehicles only, so e-bikes come from CPSC; the NHTSA feed keeps a complaint only if it reports a fire, involves no crash, and names the battery (`isBatteryFire()`). Each federal fetch has a 9-second timeout and returns `status: 'unreachable'` with no items on failure. Nothing is ever substituted. Bright Data's Web Unlocker is called only when `BRIGHTDATA_API_TOKEN` is set, and never for uploaded data. The reviews and forum posts about the fictional VR-48 are simulated in every case and labelled `simulated`.
- **H-MEM** (`src/lib/meterless.ts`, engine in `vendor/meterless-hmem`): every product signal becomes a `factual` short-term memory with its channel as provenance. Retrieval uses the engine's hybrid score (semantic, keyword, tags, entities, layer, recency, multiplied by confidence) with threshold 0.18. Recency is scored as of the dataset date (`AS_OF`, 2026-10-24) rather than the wall clock, so the converged count is stable across days.
- **Approved insights.** When a human approves a remediation, `commitRootCauseInsight()` writes a long-term memory with `derivedFrom` lineage to the converged signals. The next investigation's `priorInsights` recalls it.
- **Lot world model.** `updateWorldModel()` keeps a risk state per lot. A quarantine is sticky: re-running an investigation never un-quarantines a lot.
- **Markovian chain.** `runBoundedChain()` runs the 13 investigation steps through the vendored Markovian orchestrator. Each step sees only a compact JSON carryover (ruled-out ids, leads, confirmed causes), bounded at 512 tokens.

## 4. The statistics engine

`src/lib/stats.ts` holds every number the agent acts on. The model never produces one.

| Function | What it computes | Checked against |
| --- | --- | --- |
| `chiSquarePValue` | Upper tail of chi-square, computed in log space (Lanczos log-gamma, series and continued fraction) so p-values like 1e-300 never underflow | scipy `chi2.sf` / `chi2.logsf` |
| `chiSquareIndependence` | k x 2 test of failure rate across groups | scipy `chi2_contingency(correction=False)` |
| `monteCarloP` | Exact p-value by redistributing failures 20,000 times, seeded from the table | Determinism and conservativeness tests |
| `cochranMantelHaenszel` | Is exposure still associated with failure once a second factor is held fixed? Continuity-corrected, with the pooled odds ratio | statsmodels `StratifiedTable.test_null_odds(correction=True)` |
| `relativeRisk` | Risk ratio with a Katz log-method 95% interval | scipy `relative_risk(...).confidence_interval` |

**When the chi-square approximation is not trusted.** If more than 20% of expected cells are under 5, or any is under 1, and the asymptotic p is above 1e-6, the Monte Carlo exact test replaces it. This matters: a few baseline failures spread over 60 batches make the approximation report false significance. The reference values are in `tests/fixtures/scipy-reference.json` (generated with scipy 1.18.1 and statsmodels 0.15.0).

## 5. The investigation, step by step

`runInvestigation()` in `src/lib/investigation.ts` emits typed events (`InvestigationEvent`) that the UI folds into state.

```mermaid
flowchart TB
  subgraph Gather["Gather"]
    direction LR
    A1["Ingest feeds"] --> A2["Converge in H-MEM"] --> A3["Plan<br/>Nemotron Lightning"]
  end
  subgraph Test["Test"]
    direction LR
    B1["Screen 7 hypotheses<br/>chi-square"] --> B2["Adjudicate<br/>CMH, every pair"] --> B3["Clean strength<br/>other causes excluded"]
  end
  subgraph Prove["Prove"]
    direction LR
    C1["Robustness<br/>5 stratifications"] --> C2["Scope + concordance<br/>BOM join"] --> C3["Residual screen"] --> C4["Red team"]
  end
  subgraph Decide["Decide"]
    direction LR
    D1["Early-warning replay"] --> D2["Evidence gate<br/>7 criteria"] --> D3["Explanation<br/>number guard"] --> D4["Reveal"]
  end
  Gather --> Test --> Prove --> Decide
```

1. **Screen.** For each of the seven `DIMENSIONS` (firmware, carrier, climate zone, plant, BMS supplier, cell supplier, cell batch) one SQL `GROUP BY` and a k x 2 test. Bonferroni alpha is `0.01 / 7 = 1.4e-3`. Below it, the hypothesis is a suspect; above it, ruled out.
2. **Adjudicate.** Every suspect's hottest group is re-tested holding every other suspect's hottest group fixed (CMH). A suspect fails if any adjustment pushes it above `alpha / (G - 1)`, where G is the number of groups it was picked from: picking the worst of 60 batches after the fact has to pay for that selection. If no stratum contains both exposed and unexposed units, the two factors are **aliased** (the same units); the more specific one is kept and the other is marked redundant.
3. **Clean strength.** Each survivor's rate and relative risk are recomputed with the other survivors' units excluded, so two real causes do not inflate each other's baseline. A cause must have relative risk of at least 2.
4. **Robustness.** Each cause is re-measured within firmware, carrier, climate, BMS and warehouse strata. A stratification is consistent when the CMH test is significant and every informative stratum (at least 3 expected exposed failures) has relative risk above 2.
5. **Scope and concordance.** Physical causes are joined through `supplier_bom_lineage` and `erp_production_lots` to exact lots and serial ranges. Claims for each cause are bucketed into symptom families (connector, charging, transit, assembly, BMS); a consistent signature needs at least 40% in one specific family. For the reference batch it is 85 of 116 claims citing the connector.
6. **Residual screen.** All seven dimensions are re-screened with the confirmed causes removed. Any remaining significant structure blocks the gate. This replaced an earlier "explains at least 75% of incidents" rule, which wrongly blocked real causes that had few claims yet.
7. **Red team.** Nemotron Lightning raises objections and maps each to a deterministic check (`confounding`, `geography`, `exposure_time`, `chance`, `granularity`, `subgroups`). Objections about things the data does not measure are logged as open questions, never as answered; an open question does not block the gate.
8. **Early-warning replay.** Day by day from the first claim, the hot group is tested against the rest with a threshold Bonferroni-corrected over every group scanned. The reference batch crosses it on 2026-10-10 after 3 claims.
9. **Evidence gate.** Seven criteria: beats the multiple-testing bar, survives adjustment for every other suspect, consistent in every subgroup, nothing unexplained remains, consistent failure signature, red-team objections answered (open questions listed, not blocking), scope mapped to exact units. With no cause, the gate shows a blocked state and a "consistent with baseline noise" note instead.
10. **Explanation and number guard.** Nemotron writes the explanation from a facts object; `numberGuard()` then checks every figure in the text against the facts (allowing unit shorthand such as `10k` = 10,000) and flags anything unverified.
11. **Reveal.** Only now is the scenario's planted truth compared with what was found.

## 6. AI providers: Meterless Nightshift and NVIDIA Nemotron

Every model call goes through `nemotronChat()` in `src/lib/nemotron.ts`, which tries the configured providers in order and labels each reply with the one that answered (`via`), shown in the explanation, red team, Q&A, photo and agent trace.

```mermaid
flowchart LR
  A["Agent call<br/>plan · red team · photo · explanation · Q&A"] --> NS{"Meterless Nightshift<br/>127.0.0.1:8088/v1"}
  NS -- "answered" --> R["Reply labelled<br/>Meterless Nightshift · model or route"]
  NS -- "offline, refused or timed out" --> NIM["NVIDIA NIM<br/>Nemotron 3.5"]
  NIM --> R2["Reply labelled<br/>NVIDIA NIM · model,<br/>with the reason in the trace"]
  NIM -- "no answer" --> T["Labelled template"]
```

**Meterless Nightshift** is the hackathon's required AI provider: a local runtime that serves an OpenAI-compatible `/v1` on `127.0.0.1:8088`. Following Meterless's provider guide, Traceon sends `Authorization: Bearer <token>`, `meterless-app: traceon` and `meterless-scope: user`, normalises any pasted URL to `<host>/v1`, and reads status from `GET /v1/models` (401/403 is *unauthorized*, a list of `meterless/*` routes is *online*, anything else *offline*). Model ids are routing modes, so each job asks for a route:

| Job | Nightshift route | NIM model (fallback) |
| --- | --- | --- |
| Defect photo | `meterless/vision` | Nemotron 3.5 Super VL |
| Planning, red team, Ask the case | `meterless/fast` | Nemotron 3.5 Lightning |
| Explanation | `meterless/deep` | Nemotron 3.5 Super VL, thinking raced |

Measured on 26 Oct with Nightshift 0.92.7 on an M-series Mac and the NVIDIA key added in Nightshift: planning and red team through Nightshift to Lightning (2.7-5.1 s for the real prompts, 0.3 s for a one-word check), the explanation through Nightshift to Nemotron 3 Ultra (1-12 s), a full reference case in 18 s with the number guard verifying 20 of 20 figures. Nightshift holds Super VL out of its lineup after unreliable responses and has no other vision lane, so the photo answers with a 400 there and goes to Super VL on NIM; the photo card names NVIDIA NIM as the provider.

**Nemotron through Nightshift.** Nightshift can connect external model APIs, including NVIDIA's. When Nemotron appears in Nightshift's model list (`GET /v1/models`, read at most once a minute), each job uses the matching Nemotron model through Nightshift: Super VL for the photo and the explanation, Lightning for planning, red team and Q&A. Names are matched exactly, by suffix, or by family (`nemotron…lightning`, `nemotron…super`), so a different naming still works; when Super VL is not listed, the explanation takes Nemotron Ultra (`nemotron…ultra`). Ultra may send its reasoning ahead of a lone `</think>`, which `splitThink()` moves into the trace; `NIGHTSHIFT_*_MODEL` overrides any job and `NIGHTSHIFT_USE_NEMOTRON=off` turns the lookup off. Nemotron's thinking switch (`chat_template_kwargs`) is sent off for the fast jobs, and off for the others unless `NIGHTSHIFT_THINKING=on`, since this path has no fast-answer race; if Nightshift refuses the field, the call is repeated without it. While Super VL is held back, replies read *Meterless Nightshift · nvidia/nemotron-3-ultra-550b-a55b* (explanation) or *Meterless Nightshift · nvidia/nemotron-3.5-lightning-30b-a3b* (planning, red team, Q&A), and the agent trace says *Nemotron via Nightshift*.

`AI_PROVIDER=auto` (default) tries Nightshift first when a token is configured, with NIM as the labelled fallback, and uses NIM alone otherwise. `nim` skips Nightshift; `nightshift` uses Nightshift alone, with no NIM fallback (the photo then gets the labelled reference analysis, since Nightshift has no vision lane). To test Nightshift alone, use `npm run nightshift:check`, which also removes the NIM key: it sends one real request on each route and warms the local models before a demo. `scripts/mock-nightshift.mts` (`npm run nightshift:standin`) is a development stand-in that speaks the same protocol; it marks its replies, and the app then labels them **Nightshift stand-in** so it can never pass for the real runtime.

### Nemotron on NVIDIA NIM

`src/lib/nemotron.ts` calls NVIDIA NIM's OpenAI-compatible `/chat/completions` with `fetch`, so `chat_template_kwargs.enable_thinking` goes in the body as NIM expects.

| Call | Model | Thinking | Budget |
| --- | --- | --- | --- |
| Planning (`planHypotheses`) | `nvidia/nemotron-3.5-lightning-30b-a3b` | off | 2,000 tokens, 20 s |
| Red team (`redTeam`) | Lightning | off | 1,500 tokens, 20 s |
| Explanation (`explain`) | `nvidia/nemotron-3.5-super-vl-120b-a12b` | raced | 4,096 tokens, 45 s, thinking deadline 20 s; on failure Lightning, 900 tokens, 25 s |
| Vision (`analyzeDefectPhoto`) | Super VL | raced | 4,096 tokens, 75 s, thinking deadline 25 s |
| Ask the case (`askCase`) | Lightning | off | 500 tokens, 25 s |

These choices come from live measurement, not assumption:
- Lightning with thinking on spent its whole token budget reasoning and returned an empty answer, so its JSON tasks run with thinking off.
- NIM latency for the same thinking call ranged from about 10 seconds to over 60. So the explanation and vision **race** a thinking request against a no-thinking request. Thinking wins (and its reasoning trace is shown) if it answers before the deadline; otherwise the fast answer is used.
- Transient 429 and 5xx responses are retried twice with backoff inside the same deadline.
- If thinking exhausts the budget with no answer, the call retries once with thinking off.
- Answers repeated in full or reworded from the same opening are de-duplicated (`dedupeRepeat`).
- Replies are cached in `.nim-cache/` keyed by a SHA-256 of the request, so demo re-runs are instant. `NEMOTRON_CACHE=off` disables it.

Through Nightshift the same deadlines apply, with at least 2,000 tokens for Nemotron and no thinking race. Every fallback is logged in the agent trace with its reason. With neither Nightshift nor `NVIDIA_API_KEY` configured, each step uses a labelled template and the statistics are unchanged.

## 7. Zetaris integration

`src/lib/zetaris.ts` implements the Zetaris SaaS SQL API from its published OpenAPI spec (`api.saas.enterprise.zetaris.com/redoc/docs.yaml`):

| Step | Call |
| --- | --- |
| Authenticate | `ZETARIS_API_TOKEN` as a Bearer token, or `GET /api/v1.0/auth/login` with Basic auth, then `/auth/refresh` |
| Run | `POST /api/v1.0/query/sql/start` with `{select, pageLimit: 100}` |
| Page | `GET /api/v1.0/query/sql/page?queryToken&pageLimit&pageNumber`, up to 50 pages |
| Close | `DELETE /api/v1.0/query/sql/close/{queryToken}` |

Every request carries `X-Request-ID` (a fresh UUID) and `X-Org-ID`. Local table names are mapped by `ZETARIS_SCHEMA` (for example `traceon.unit_fact`) or per table by `ZETARIS_TABLE_MAP`, so silos can live in different Zetaris sources.

**Hashes that survive a change of engine.** Spark may return rows in any order and numbers as strings. `canonicalRows()` lowercases keys, normalises numbers and booleans and sorts rows before hashing, so the cloud and the mirror produce the same proof hash for the same data. `zetarisParityCheck()` runs four probe queries on both and compares hashes; `npm run zetaris:check` and the app's status chip report it.

**Transient faults.** Hackathon clusters answer some internal faults with a 400 (`Could not create ResultSet: null`, `TTransportException`), and a cold cluster can be slow on the first query. `runCloudQuery()` retries those, plus 429/5xx and timeouts, twice (after 1 s and 3 s); a real refusal such as bad SQL or an unknown table is not retried. A query that still fails opens a circuit breaker: the cloud is skipped for 60 s, so a dead cluster costs one query's retries rather than every query's. The start call waits up to 55 s, just under the 60 s REST limit. Queries run one at a time. Run `npm run zetaris:check` shortly before a demo to warm the cluster.

**Fallback.** If the cloud is not configured, or a call fails, the same SQL runs on the scenario's alasql mirror and the result carries `executedVia: 'LOCAL_FEDERATED_MIRROR'` and a `fallbackReason`. Only the reference scenario's data is loaded into Zetaris, so other scenarios always run on the mirror, labelled as such.

## 8. Proof chain and replay

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent
  participant Z as Zetaris or mirror
  participant L as Proof chain
  participant V as Replay (/api/verify)

  A->>Z: SQL
  Z-->>A: rows
  A->>L: proofHash = sha256(sql, canonical rows)
  L->>L: head = sha256(head, proofHash, label)
  Note over L: genesis = sha256("traceon:VR-48:2026-10-24", scenario)
  V->>Z: re-run every stored SQL
  V->>V: recompute each proofHash and the chain
  alt every hash and the root match
    V-->>V: ok, root returned
  else a query, order or scenario changed
    V-->>V: mismatches listed by evidence id
  end
```

Every evidence item (feeds, memory, model output, SQL, statistics) is appended to `ProofChain` in `src/lib/investigation.ts`. `verifyLedger()` in `src/lib/actions.ts` replays it; an uploaded bundle is replayed only if it belongs to a run or case this server recorded, and only the SQL recorded for that run is executed. `tests/proof.test.mts` proves that a tampered query, swapped or dropped evidence, and a ledger checked against the wrong scenario all fail.

## 9. Remediation

`executeRemediation()` in `src/lib/actions.ts` acts only on a request that names its causes, its approver and its ledger root. Before it runs, `/api/quarantine` calls `authorizeRemediation()` in `src/lib/runRegistry.ts`: the ledger root must belong to a completed run whose evidence gate passed, and every requested cause must be one that run confirmed. Anything else is refused with 403, so the gate holds even for someone calling the API directly.

| Cause column | Remedy | Cost per unit | What happens |
| --- | --- | --- | --- |
| `cell_batch`, `cell_supplier`, `plant_id`, `bms_supplier` | Surgical quarantine | $25 | Every matching serial written to `erp_holds` as `BLOCKED_STOCK` |
| `firmware` | OTA firmware rollback | $0.40 | Rollback order with a 90% charge limit |
| `carrier` | In-transit inspection | $3 | Inspection order |
| `climate_zone` | Customer advisory | $0 | Advisory notice |

Columns are whitelisted and values SQL-escaped. The hold id is a hash of the scenario, ledger root and causes, so a repeated approval reports `alreadyQuarantined` instead of duplicating rows. The function drafts the distributor stop-sale notice, any OTA or operations order, and a CPSC Section 15(b) report draft for counsel, then commits the finding to long-term H-MEM memory.

## 10. Runtime: runs, recovery and health

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant API as /api/investigate
  participant R as Run registry
  participant E as Agent

  B->>API: POST scenario
  alt a run is active
    API-->>B: 409 with its runId
    B->>API: GET ?run=id&from=0, every second
  else free
    API->>R: startRun
    R->>E: runInvestigation, watchdog 240 s
    API-->>B: NDJSON stream, X-Run-Id
    E-->>R: events appended to the run log
    R-->>B: streamed events
  end
  Note over B,API: if the stream drops, the browser polls GET ?run=id&from=n
  E-->>R: done
```

- **One run at a time.** `startRun()` throws `BusyError`; the route answers 409 with the active run id, and the page attaches to it instead of failing.
- **Watchdog.** After `RUN_TIMEOUT_MS` (default 240 s) the run is closed with an error and a terminal `done`, and the lock is released. Late events from an abandoned run are ignored.
- **Recovery.** Events are kept in the run log, so a client whose stream drops catches up with `GET /api/investigate?run=<id>&from=<n>`.
- **Health.** `GET /api/health` returns 200 when the query engine answers (180,000 units) and storage is writable, 503 otherwise. Feeds and models only mark it `degraded`.

## 11. Interface

- **Landing page** (`src/app/page.tsx`, `src/app/landing.css`): a report-style page with an animated proof figure. `src/components/ConfounderTable.tsx` lets the reader flip "Hold cell batch fixed" and watch four suspects collapse into confounders. `src/components/LandingMotion.tsx` adds scroll reveals, count-ups and a scroll-spy, only when JavaScript runs and the visitor allows motion.
- **Case file** (`src/app/app/page.tsx`): three panes. Intake (`SignalPane`), investigation (`CausalDag`, `Insights`), disposition (`ActionPane`). Every graph node opens an exhibit (`EvidenceModal`) with its SQL, where it ran, the rows and both hashes.
- **Section menu** (`src/components/AppNav.tsx`): Case file, Watch, Real recalls, Your data and Scoreboard sit in the app's top bar (and its drawer on phones); the other pages use `SiteHeader`, which carries the same menu. The landing page keeps its own four-item menu.
- **In-case tools** (`src/components/CaseTools.tsx`) sit next to the evidence they use. In the investigation pane: Uncertainty and What would prove this wrong beside the red team and subgroup table, then Ask the case and What if under "Case tools". In the disposition pane: Verify the fix after approval, Reports and review, and the signed timestamp inside the proof ledger. A citation in an answer opens its exhibit.
- **Design system** (`src/app/globals.css`): paper, ink and hairline rules; Newsreader, IBM Plex Sans and IBM Plex Mono through `next/font`; one signal colour for the cause and the actions it drives.
- **Phones and tablets** (900 px and below): the three panes become tabs under a sticky top bar, with a marker on Disposition once the gate has decided. The scenario picker, integration status and Reset move into a left drawer (the same `.controls` element, which is layout-transparent on desktop through `display: contents`). The proof graph keeps legible text by scrolling sideways inside its frame, and exhibits open as a full-screen sheet. Inputs are 16 px so iOS does not zoom on focus, and primary controls are at least 44 px tall. The landing page gets the same burger and left drawer (`src/components/LandingNav.tsx`).

## 12. Beyond one case

Every feature below reads a finished investigation from its own event log, through one function: `buildCaseView()` in `src/lib/caseView.ts`. `loadEvents(id)` accepts either a run id (still in the registry) or a saved case id. So the Q&A, the reports, the what-if simulator and the follow-up all see exactly what the agent produced, and none of them recompute the verdict.

```mermaid
flowchart LR
  RUN["Run registry<br/>event log"] --> CV["buildCaseView()<br/>caseView.ts"]
  CASE[("Saved case<br/>cases/*.json")] --> CV
  CV --> ASK["Ask the case<br/>ask.ts + numberGuard"]
  CV --> CF["What if<br/>counterfactual.ts"]
  CV --> FU["Verify the fix<br/>followup.ts"]
  CV --> REP["8D and supplier claim<br/>reports.ts"]
  CV --> ST["Signed timestamp<br/>stamp.ts"]
  RUN -- "Share for review" --> CASE
  W["Watch<br/>watch.ts"] -- "alert: id@date" --> RUN
  D["Your data<br/>datasets.ts"] -- "custom-id" --> RUN
  BT["Real recalls<br/>realRecall.ts"] --- NHTSA[("data/nhtsa<br/>snapshots")]
```

| Feature | Code | API | How it works |
| --- | --- | --- | --- |
| Real-recall backtest | `src/lib/realRecall.ts`, `data/nhtsa/*.json`, `scripts/snapshot-nhtsa.mts` | `GET /api/backtest[?case=]`, `POST /api/backtest` | Disproportionality analysis (Evans et al., 2001): a vehicle's share of fire complaints per component family against ten comparator vehicles. Signal when PRR ≥ 2, Yates chi-square ≥ 4 and at least 3 cases. A lead time counts only against a fire-related recall of the same component family. Five cases ship as snapshots so it works offline; `POST` runs any vehicle live against api.nhtsa.gov |
| Your data | `src/lib/datasets.ts` | `GET/POST /api/datasets` | RFC 4180 parser, column profile, mapping validation (at least 3 failures, 2 to 500 values per factor, at most 12 factors and 400,000 rows). Optional columns switch on the date, symptom, exposure and serial checks; the gate marks checks without data as N/A instead of passing them. The failure signature on uploaded data is the word most of the cause's claims share |
| Watch | `src/lib/watch.ts` | `GET /api/watch?scenario=` | Units and claims are added day by day; each day every factor gets a chi-square screen against 0.01/k. The first day past the bar with at least 5 failures in the hottest group opens `<id>@<date>`. The screen only flags association; the investigation decides |
| Ask the case | `src/lib/ask.ts` | `POST /api/ask` | The case record is flattened into facts, each tied to its exhibit (one fact per CMH adjustment, citing that exact test). Nemotron Lightning answers from the record only; citations to unknown exhibits are flagged and every figure passes `numberGuard()`. Without the model, the closest facts are returned as they are |
| What if | `src/lib/counterfactual.ts`, `WhatIf` in `src/components/CaseTools.tsx` | `GET /api/counterfactual?id=` | The server sends the tested k×2 table and the cause's claims by date; the browser re-runs `chiSquareIndependence()` from `stats.ts` as the sliders move: the action date, the share of the excess failures that is real, and the share of the data available |
| Falsifiers and intervals | `src/lib/investigation.ts` step 11b, `src/lib/stats.ts` | `forest` event, `CauseFinding.falsifiers` | Wilson intervals for rates and coverage, an exact Poisson 90% range for the 30-day projection, a forest plot of every suspect's relative risk, and four pre-registered conditions that would overturn each cause |
| Verify the fix | `src/lib/followup.ts` | `POST /api/followup` | Simulates 30 days on the scenario's own hazards (seeded from the ledger root), then checks that failures return to baseline (exact Poisson) and that no factor concentrates the new failures. `wrong-fix` acts on the leading confounder instead, which reopens the case. Labelled as a simulation in the UI |
| Reports | `src/lib/reports.ts` | `GET /api/report?id=&kind=8d\|supplier` | Printable HTML. Every claim cites its exhibit; the exhibit index and the proof root close the document |
| Signed timestamp | `src/lib/stamp.ts` | `POST /api/proof/stamp`, `GET /api/proof/stamp?root=&file=`, `GET /api/proof/key` | An Ed25519 signature (key in storage, or `TRACEON_SIGNING_KEY`) over a short statement naming the root, plus an OpenTimestamps proof of that statement from the public calendars. The `.ots` file verifies with the standard `ots` client; if no calendar answers, the stamp is signature-only and says so |
| Reviewer mode | `src/lib/cases.ts`, `src/app/case/[id]/page.tsx` | `POST /api/cases`, `GET /api/cases/[id]`, `GET/POST /api/cases/[id]/comments` | Freezes a finished run's events as a case whose id derives from the ledger root. The case page folds the events through the same reducer as the live app and is read-only; comments pin to an exhibit or to the whole case |
| Scoreboard | `src/lib/scoreboard.ts` | `GET /api/scoreboard` | Each run where Nemotron planned records whether its first-ranked suspect was confirmed and, on generated data, whether it and the tested verdict matched the planted truth |

## 13. Testing and evaluation

| File | Tests | What it proves |
| --- | --- | --- |
| `tests/stats.test.mts` | 7 | The statistics match scipy and statsmodels; sparse tables use the exact test |
| `tests/scenarios.test.mts` | 6 | Correct verdicts on reference, firmware, two causes, noise and random seeds 1-40 |
| `tests/proof.test.mts` | 6 | Replay works; tampering is caught; remediation is exact, idempotent and injection-safe |
| `tests/degrade.test.mts` | 5 | A hanging model, dead feeds and an unreachable Zetaris all degrade cleanly |
| `tests/registry.test.mts` | 2 | The one-run lock and the watchdog |
| `tests/e2e.test.mts` | 5 | A real production server: health, validation, 409 and attach, dropped-stream recovery, replay over HTTP, and the server-side evidence gate |
| `tests/nightshift.test.mts` | 7 | Nightshift protocol (token, `meterless-app` header, URL normalising, status rules), the route per job, Nemotron picked when connected to Nightshift, the thinking-switch retry, the labelled fallback to NIM, and damage boxes in any common shape |
| `tests/zetaris.test.mts` | 4 | Transient cluster faults are retried, real refusals are not, repeated faults open a 60 s circuit breaker, and a rejected session is replaced by a fresh sign-in |
| `tests/hardening.test.mts` | 7 | Regressions for the Oct 25 audit: read-only SQL, replayed bundles cannot write or forge summaries, upload validation (backslashes, single suspect, duplicate serials, malformed mapping, unparseable dates, full-content ids), strict scenario ids, reset scope, server-issued photo findings |
| `tests/features.test.mts` | 18 | Bolt EV backtest and whether each recall's fix held; an uploaded CSV solved with its confounder ruled out; CSV parsing; watch alert and that day's verdict; as-of truth; falsifiers and intervals; counterfactual inputs; follow-up verified vs reopened; stamp signatures; reviewer cases and comments; cited Q&A; reports; scoreboard; the NHTSA and openFDA intake filters; Bright Data news parsing; the hottest group chosen by evidence |
| `tests/fix-*.test.mts` | per file | Regressions for the Oct 27 audit, one file per area of the fixes; `tests/fix-docs.test.mts` keeps the docs and the landing page in line with the code (counts, labels, scripts, links, licences) |

`scripts/eval.mts` (`npm run eval`) runs the agent blind on hidden scenarios and reports accuracy by cause type and whether any wrong cause was acted on.

## 14. Known limitations

- **Simulated enterprise data.** The factory, supplier and warranty silos are generated. The method is real; the company is not.
- **Fixed dimensions per dataset.** The demo tests seven factors and an upload tests the columns it maps. Nemotron can name others, which are logged as untestable rather than tested.
- **Follow-up is simulated.** Verification after the fix runs on simulated days drawn from the scenario's observed hazards. With real data the same checks would run on the claims that arrive.
- **Backtest matching is approximate.** A signal and a recall are matched by component family and fire wording, not proven to be the same defect, and complaints have no sales denominator.
- **No access control.** Shared cases, comments and uploaded datasets are stored as plain JSON on the server. Anyone with a case's URL can read it and its comments, uploaded datasets are listed for every visitor (`GET /api/datasets`, and the list on `/data`), and `GET /api/investigate` reveals the active run. Add authentication before real use. `TRACEON_DISABLE_RESET=1` turns off the demo reset.
- **CPU per new scenario.** Each new `random-<seed>` (1 to 999,999) builds a 180,000-row mesh and, in watch mode, about a second of screening. Meshes and replays are cached, but there is no rate limit.
- **Bright Data's reach without KYC.** The Web Unlocker refuses Reddit, Endless Sphere and the Chevy Bolt forum until the account is verified, so the live feed uses Google News. Reviews of the fictional VR-48 stay simulated, and the news never enters a case's evidence, so the reference proof is unaffected by it.
- **Single process.** The mirror, holds and run registry are in memory. Restarting the server clears holds (memory on disk survives).
- **Zetaris holds the reference scenario only.** On the live server the Zetaris platform (the hackathon's Docker distribution) answers the reference case's 46 queries with hash parity (`npm run zetaris:check`, and the top bar's *Zetaris cloud · parity ok*). Other scenarios and uploads run on the local alasql mirror, labelled in each exhibit. The adapter is also tested against a spec-conformant test double (`scripts/mock-zetaris.mts`).
