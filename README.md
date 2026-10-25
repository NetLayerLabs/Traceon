# Traceon

**An agent that finds the root cause of a product-safety defect, proves why every other explanation is wrong, and only then lets a human quarantine the exact affected units.**

Open Agent Hackathon 2026 · Track 02, *The Agent That Can Explain Why* · NVIDIA Nemotron · Zetaris · Meterless · Bright Data

---

## The problem

Before a battery recall makes the news, the warning signs are already there, scattered across warranty claims, 1-star reviews, forum posts and federal safety databases. Quality teams spend weeks joining spreadsheets. When they finally act, they often recall everything because they can't prove which lot is bad.

## What Traceon does

In about five seconds, on 180,000 units of factory data:

1. **Converges weak signals.** Warranty claims, web chatter and live federal feeds go into Meterless H-MEM, which pulls 131 scattered reports into one thermal-connector cluster.
2. **Tests every suspect.** Nemotron ranks seven hypotheses (firmware, carrier, heat, plant, BMS board, cell supplier, cell batch). Each is tested with SQL across the federated silos and a chi-square test.
3. **Unmasks confounders.** Four suspects look guilty on raw data. Cochran–Mantel–Haenszel tests show their effect vanishes once the real cause is held fixed. Example: Sun Belt heat looks guilty only because the bad batch was shipped mostly to Phoenix and Austin.
4. **Attacks its own verdict.** A Nemotron red-team pass raises objections. Each one is answered by a deterministic test, not by argument.
5. **Refuses to act on weak evidence.** A 7-criterion evidence gate must pass before the quarantine button even appears.
6. **Acts surgically, with a human in the loop.** It places an ERP hold on 1,380 serials instead of recalling 180,000, saving $4.47M. It also drafts the stop-sale notice and a CPSC Section 15(b) report.
7. **Proves everything.** Every query and model output is hashed into a chain. "Replay & verify" re-executes all 45 SQL queries and checks every hash.

## Not scripted: blind scenarios

The obvious objection is "you planted the defect, so of course it finds it." So the same agent runs blind on different hidden causes. Pick one in the app's scenario menu:

| Scenario | What's planted | What the agent must do |
|---|---|---|
| Reference | Bad cell batch, hidden behind heat and plant confounders | Find the batch, unmask 4 confounders |
| Firmware bug | Firmware v3.4 overcharges; rolled out first in the Sun Belt | Confirm firmware, clear the batch, prescribe an OTA rollback |
| Two causes | Bad batch **and** firmware bug at once | Find both, with a different remedy for each |
| No defect | Complaints, but only baseline noise | Find nothing and **block** any recall |
| Random | Hidden cause drawn from a seed (batch, firmware, plant, carrier, BMS, two causes or none) | Investigate blind; the truth is revealed only after the verdict |

**Blind accuracy** (`npm run eval`): **304/304** correct on the four named scenarios plus random seeds 1–300, including **250/250 on held-out seeds 151–400** that were never used while tuning the method. "Correct" means exactly the planted causes were found, and action was allowed only if a cause exists. Zero runs acted on a wrong cause.

Building this exposed three real methodology flaws, which are now fixed:
- **Sparse tables.** The chi-square approximation overstates significance at low counts, for example a few baseline failures spread over 60 batches. Such tables now get a seeded Monte Carlo exact test.
- **Post-hoc selection.** Picking the worst of 60 groups now pays a multiplicity correction.
- **Two causes contaminating each other.** Each cause is now measured with the other causes' units excluded. A residual screen also checks that nothing unexplained remains.

## What makes it different

| | |
|---|---|
| **The LLM never makes up a statistic** | Nemotron plans, red-teams, inspects photos and explains. Every p-value, rate and dollar figure is computed in code. |
| **Confounder detection** | The agent doesn't stop at "correlated". It shows which suspects are explained away by the real cause, and by how much. |
| **Hallucination guard on the explanation** | Every number in the written explanation is checked against the evidence. Unverified figures are flagged in red. |
| **Evidence gate** | The agent blocks its own action unless significance, confounder adjustment, subgroup consistency, no unexplained residual, a consistent failure signature, the red team and scope all pass. With no real cause, it refuses to recall. |
| **Early-warning replay** | Replays the claim history day by day. The defect was statistically detectable on Oct 10 after 3 claims, and 113 later incidents were preventable. |
| **Reproducible proof** | A SHA-256 hash chain covers every evidence item. Anyone can re-run the queries and get the same root hash. |
| **Memory across sessions** | Once a human approves the quarantine, the finding becomes long-term H-MEM memory. The next investigation recalls it. |

## Real vs simulated (stated plainly)

| Component | Status |
|---|---|
| CPSC, openFDA MAUDE, NHTSA feeds | **Live** public APIs, no key needed. Shown as context (e-bike recall base rates, adjacent lithium-battery reports). |
| Factory, BOM, warehouse and warranty data | **Simulated**: a fictional company (VoltRide) and SKU, generated deterministically with a planted defect. The agent is never told the answer. |
| Web reviews and forums | **Simulated** unless `BRIGHTDATA_API_TOKEN` is set, in which case Reddit is fetched live through the Bright Data Web Unlocker. |
| Nemotron | **Live** with `NVIDIA_API_KEY` (tested end to end): **Nemotron 3.5 Super VL** for vision and the explanation (thinking on, raced against a fast answer so latency spikes never stall the demo), **Nemotron 3.5 Lightning** for planning and the red team. Transient NIM errors are retried; replies are cached in `.nim-cache`. `npm run nemotron:check` runs a live check. Without a key, labeled templates are used and the statistics are identical. |
| Zetaris | Implements the official Zetaris SaaS SQL API (start / page / close, per the published OpenAPI spec). It runs on your Zetaris instance when configured, with a hash-parity check against the demo data. Otherwise it uses a local federated SQL mirror (alasql). Every query is labeled with where it ran. See [docs/ZETARIS_SETUP.md](docs/ZETARIS_SETUP.md). |
| Meterless | **Real**: the official H-MEM and Markovian reference engines, vendored from `github.com/Meterless/Meterless`. |

The UI labels every one of these states, so judges always know what they are looking at.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add NVIDIA_API_KEY etc.
npm run dev                  # http://localhost:3000 (landing) · /app (the app)
```

- `http://localhost:3000/app?autorun=1` starts an investigation on load (useful for recording).
- **Reset demo** (top bar) clears H-MEM memory and ERP holds.
- `http://localhost:3000/app?scenario=random&autorun=1` runs a random hidden scenario (`reference`, `firmware`, `two-causes`, `noise` and `random` also work).
- `npm test` runs the full suite (30 tests, about a minute). It includes an end-to-end run against a real production server.
- `npm run eval -- 300` runs the blind accuracy benchmark.
- `GET /api/health` reports the query engine, storage, feeds, models and any active run (200 when the core works, 503 when it doesn't).
- `npm run zetaris:export` writes the silos as CSVs for Zetaris; `npm run zetaris:check` verifies the live connection and data parity; `npm run zetaris:mock` starts a spec-conformant test double.

## Tested, not just demoed

`npm test` covers:

| Area | What's checked |
|---|---|
| Statistics | Chi-square tails (log space), k×2 independence, Cochran–Mantel–Haenszel and relative-risk CIs match **scipy 1.18 / statsmodels 0.15** reference values ([tests/fixtures](tests/fixtures/scipy-reference.json)); sparse tables use the exact test |
| Reasoning | Reference, firmware, two-cause and noise scenarios, plus 40 random seeds |
| Proof | Every query replays to the same hash; a tampered query, reordered or dropped evidence, or the wrong scenario all fail verification |
| Actions | ERP hold covers exactly 1,380 serials, is idempotent, rejects non-actionable columns and quoted-SQL injection, and is recalled by the next run |
| Degradation | A hanging Nemotron times out and falls back to templates. Unreachable feeds are reported, never faked. Zetaris down falls back to the mirror and records why. The verdict is unchanged in all three cases |
| Hardening | One run at a time (409, with the option to attach); a watchdog ends hung runs and frees the lock; a dropped stream is recovered from the server's event log; bad input gets 4xx |

## Architecture

```
 Signals                     Context (Meterless)            Reasoning                     Action
 ─────────────────────       ─────────────────────          ─────────────────────         ─────────────────────
 Warranty claims (silo) ┐    H-MEM: durable memory,         Nemotron: rank hypotheses,    Evidence gate (7 checks)
 Bright Data web        ├──> hybrid retrieval, trust  ──>   red-team, vision, explain  ─> Human approval
 CPSC / openFDA / NHTSA ┘    ledger, approved insights      Stats engine: chi-square,     ERP hold (1,380 serials)
                             Markovian: bounded chain       CMH, RR, Bonferroni           Stop-sale + CPSC 15(b)
                             Lot world model                Zetaris: federated SQL        H-MEM long-term insight
                                                                     │
                                                    Proof chain: SHA-256 over every query + model output
```

| File | Role |
|---|---|
| [src/lib/investigation.ts](src/lib/investigation.ts) | The agent: screen → adjudicate confounders → robustness → scope → vision → red team → replay → gate → explain |
| [src/lib/stats.ts](src/lib/stats.ts) | Chi-square, Cochran–Mantel–Haenszel, relative risk, log-space p-values |
| [src/lib/zetaris.ts](src/lib/zetaris.ts) | Zetaris SQL API client (auth, paging, table mapping), canonical proof hashes, local mirror fallback, parity check |
| [src/lib/meterless.ts](src/lib/meterless.ts) | H-MEM ingestion and convergence, lot world model, Markovian chain |
| [src/lib/nemotron.ts](src/lib/nemotron.ts) | NIM client (`chat_template_kwargs.enable_thinking`), reasoning-trace capture |
| [src/lib/vision.ts](src/lib/vision.ts) | Nemotron 3.5 Super VL defect-photo forensics with bounding box |
| [src/lib/signals.ts](src/lib/signals.ts) | Live federal feeds and Bright Data |
| [src/lib/actions.ts](src/lib/actions.ts) | Remediation per cause type (ERP hold, OTA rollback, inspection), notices, memory commit, ledger replay |
| [src/lib/runRegistry.ts](src/lib/runRegistry.ts) | One-run lock, watchdog, event log for stream recovery and attach |
| [src/lib/enterpriseData.ts](src/lib/enterpriseData.ts) | Deterministic simulated silos and scenarios (planted causes, hidden random seeds) |

## Deploying

Use a single long-running Node host (Railway, Render, Fly). The local federated mirror and the ERP holds live in process memory, and H-MEM writes to disk. On serverless platforms like Vercel, those reset between instances and `.meterless-data` falls back to `/tmp`. The analysis still works there, but cross-session memory won't persist reliably.

```bash
npm run build && npm start
```

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the 2-minute demo walkthrough. The original planning documents are in [docs/plan/](docs/plan/).
