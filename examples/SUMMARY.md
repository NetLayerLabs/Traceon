# Traceon sample run

Run 2026-10-26T21:58:13.336Z: offline, no keys, no network. Model steps use labelled templates; every statistic, verdict and proof is computed exactly as in live mode.

## 1. Reference case: 125 thermal claims, seven suspects
- Verdict: **cell_batch = CB-B-0917**, relative risk 1668x, explains 92.8% of incidents
- Ruled out as confounders: Sun Belt heat exposure, Plant assembly defect, BMS board supplier, Cell supplier quality
- Evidence gate: PASSED (7/7 criteria)
- Action: hold 1,380 units instead of recalling 180,000, saving $4,465,500
- Proof: 56 exhibits; replayed 46 SQL queries, root matches (8f694a74fa37d4c0…)
- 1.0 s
- Outputs: sample-output/reference/ (event log, proof bundle, replay result, explanation, 8D report, supplier claim)

## 2. Verify the fix (simulated 30 days)
- Planned quarantine: fix verified, case closed
- Acting on the climate zone confounder instead: fix failed, case reopened

## 3. Blind scenarios (planted cause hidden until the verdict)
| Scenario | Planted | Found | Gate | Result |
| --- | --- | --- | --- | --- |
| firmware | firmware=v3.4 | firmware=v3.4 | allowed | correct |
| two-causes | cell_batch=CB-B-0917 + firmware=v3.4 | firmware=v3.4 + cell_batch=CB-B-0917 | allowed | correct |
| noise | none | none | blocked | correct |
| random-77 | cell_batch=CB-B-0935 | cell_batch=CB-B-0935 | allowed | correct |
| random-4242 | carrier=DHL | carrier=DHL | allowed | correct |

## 4. Uploaded CSV, generated (12,000 chargers, public/samples/charger-returns.csv)
- Verdict: resin_lot=R-2207; night shift: ruled out as a confounder; gate PASSED

## 5. Real uploaded data: Backblaze hard drives, Q2 2026 (355,689 drives)
- Worst model: HGST HUH721212ALN604 (p = 2.9e-205); gate BLOCKED
- model: Not material on its own. With sac2 excluded, HGST HUH721212ALN604 fails at 42/10k vs 34/10k for the rest (RR 1.2, below the 2x bar): its excess is concentrated where sac2 is.
- datacenter: Not material on its own. With HGST HUH721212ALN604 excluded, sac2 fails at 56/10k vs 34/10k for the rest (RR 1.6, below the 2x bar): its excess is concentrated where HGST HUH721212ALN604 is.
- age_band: Ruled out as a confounder. 7y+ only looks guilty because it shares units with HGST HUH721212ALN604; holding f_model fixed, the effect disappears (p = 0.16).
- Reading: the failures sit where that model and data centre sac2 overlap, a cohort, so no fleet-wide action on either is justified.

## 6. Real recalls: public NHTSA complaint histories
| Vehicle | Signal fired | Fire recall | Result |
| --- | --- | --- | --- |
| CHEVROLET BOLT EV | 2020-10-30 (ELECTRICAL) | 2020-11-13 20V701000 | 14 days early |
| KIA SORENTO | 2017-07-11 (ENGINE) | 2017-09-21 17V586000 | 72 days early |
| HYUNDAI SANTA FE | 2021-01-19 (SERVICE) | 2022-02-03 22V056000 | 380 days early |
| HYUNDAI KONA ELECTRIC | never | 2020-10-13 20V630000 | no-signal |
| FORD ESCAPE | 2014-03-20 (ENGINE) | 2012-09-04 12V431000 | late |

After the recall (real complaints; year before vs the year from 90 days after):
- Bolt EV 20V701000 (2020-11-13): did not hold. 6 fire complaints in the year from 90 days after the recall, against 3 in the year before (no significant drop, p = 0.91); another fire recall of the same component followed on 2021-07-23 (21V560000).
- Bolt EV 21V560000 (2021-07-23): fix held. 0 fire complaints in the year from 90 days after the recall, against 5 in the year before (significant drop, p = 0.031), while owners kept filing other complaints (50).

## All checks passed.

Open the reports in sample-output/reference/ in a browser. To use the full app in the same offline mode: ./sample.sh --serve, then http://localhost:3000
