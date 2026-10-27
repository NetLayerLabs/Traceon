# Before submission: Oct 27, 2026, 23:45 UTC

Checklist and roadmap for the NetLayer Labs entry. The repository is [NetLayerLabs/Traceon](https://github.com/NetLayerLabs/Traceon).

## Built (as of Oct 27)

- [x] Investigation agent, evidence gate, proof chain, remediation; blind accuracy 304/304, held out 250/250
- [x] Live Nemotron for every model step, with thinking raced against a fast answer and replies cached
- [x] The 13 features beyond one case, each in the section menu or next to the evidence it uses:
  - [x] Real-recall time machine (`/backtest`): Bolt EV 14 days early, Sorento 72, Santa Fe 380
  - [x] Your data (`/data`), with two samples: 355,689 real Backblaze drives and a generated 12,000-charger set
  - [x] Watch (`/watch`): alert on Oct 11, and that day's case confirms the batch
  - [x] Ask the case, with exhibit citations and the number guard
  - [x] What if sliders that re-run the statistics
  - [x] What would prove this wrong (pre-registered falsifiers)
  - [x] Uncertainty: forest plot, rate and coverage intervals, projection range
  - [x] Supplier claim and 8D report
  - [x] Verify the fix (simulated 30 days; the wrong fix reopens the case)
  - [x] Signed, OpenTimestamps-anchored proof root
  - [x] Reviewer mode with comments pinned to exhibits
  - [x] Scoreboard of model guesses against tested verdicts
- [x] Phone and tablet layout re-checked (55/55), including the section menu in the drawer

## Required by the organisers

- [ ] **Create the HackOS submission**, even unfinished. Add teammates first: the roster locks on creation.
- [x] **Meterless Nightshift as the AI provider** (code): every model call goes to Nightshift first, Nemotron on NIM as the labelled fallback. Tested against a stand-in and against the real Nightshift (next item).
- [x] **Install Nightshift**: done Oct 26 (v0.92.7, the free Mac M1+ edition from meterless.ai). `NIGHTSHIFT_TOKEN_FILE` points at its `runtime-token` file, and `npm run nightshift:check` passes with **Meterless Nightshift** (not "stand-in").
- [x] **In Nightshift, connect the NVIDIA API**: done Oct 26 under Setup → Cloud provider keys. Traceon finds Nemotron in Nightshift's model list and uses it, so planning, red team and Q&A are Nemotron Lightning via Nightshift and the explanation is Nemotron Ultra via Nightshift. Nightshift holds Super VL back as unreliable and has no vision lane, so the photo goes to Super VL on NIM, labelled.
- [x] At least one Meterless engine in a working feature: done (H-MEM and Markovian).
- [ ] **Public GitHub repo** with README (history checked: no keys or personal data).
- [ ] **Slide deck**: problem, users, solution, architecture, sponsor tech (12 slides drafted; final check of the figures).
- [ ] **Demo video (1-4 min)**: main workflow, Zetaris being queried, a Meterless engine at work, and one real request through Nightshift.
- [ ] **Sponsor tech explanation** in the submission form.
- [x] **At least three sample inputs and outputs in the README**: four, in "Examples: inputs and outputs", with the reference case's outputs committed in `examples/`.
- [x] **Judgeable without live access**: `./sample.sh` runs the whole engine offline in one command (tested in a fresh local clone; `--serve` then starts the app with every key switched off).
- [x] **Live deployment**: https://traceon.netlayerlabs.com, with the Zetaris platform on the same server. Live Zetaris parity OK.
- [ ] **Keep it running until the results on 6 Nov**: the server, Zetaris and the NVIDIA credits.
- [ ] Before recording: `npm run zetaris:warm` (every demo query once) and `npm run nightshift:check` (warms the models); keep a recorded fallback take.

## Make it real, one at a time (in this order; finish one before starting the next)

- [x] **1. Zetaris**: done Oct 26. The Zetaris platform (the hackathon's Docker distribution) runs on the live server and on the Mac; tables in Parquet, parity OK, 46/46 queries of the reference case on Zetaris. Remaining nice-to-have: firmware, two-causes and noise as extra schemas, so the named scenarios run on Zetaris too.
  - The client retries the 400 faults other teams hit on these clusters (`Could not create ResultSet: null`, `TTransportException`), waits up to 55 s for a cold start, and skips the cloud for 60 s if it keeps failing.
  - Before recording: run `npm run zetaris:warm` a few minutes before, to warm the cluster.
  - Setup notes (org ID, local host, warm-up) are in [docs/ZETARIS_SETUP.md](docs/ZETARIS_SETUP.md).
- [x] **2. Intake NHTSA feed**: done Oct 26. EVs with a battery-fire history (Bolt EV 2017-19, Kona Electric 2019-20), strict filter: fire reported, no crash, battery named. Live: 4 genuine Bolt EV battery fires (two are the fires the backtest flags before GM's recall). NHTSA has no e-bike data; CPSC covers e-bikes.
- [x] **3. openFDA feed**: done Oct 26. Narrowed to lithium-battery thermal events: query on lithium + fire/smoke/thermal runaway/melted, then each report's narrative must name a lithium battery and the event (no lithium heparin). Live: 45 of the latest 100 reports, e.g. a cell defect causing thermal runaway, devices catching fire while charging.
- [x] **4. Sample defect photo**: done Oct 26. Real NTSB evidence photo (JAL Boeing 787 lithium-ion battery after thermal runaway, Boston 2013; public domain, via Wikimedia Commons), labelled in the app as a stand-in for a customer photo. Nemotron reads it live: thermal runaway, charred cells, melted busbars, burnt terminal block.
- [x] **5. Bright Data**: done Oct 26. Web Unlocker zone `web_unlocker1` (pay per success, free credits). Reddit and e-bike forums are blocked without KYC, so the live feed is Google News on e-bike battery fires (~95 real recent reports), shown as context; VR-48 reviews stay simulated because the product is fictional.
- [x] **6. Real dataset on Your data**: done Oct 26. Backblaze Drive Stats Q2 2026 reduced to one row per drive (355,689 drives, 1,517 failures), bundled as the first sample with model, data centre and age as suspects. Fixed two method issues it exposed: the hottest group is chosen by evidence (z-score, at least 3 failures) not raw rate, and a suspect ruled out on materiality now says why.
- [x] **7. Real follow-up**: done Oct 26. On the NHTSA cases, real complaints after each recall: the Bolt EV's first fix (20V701000) did not hold; the battery replacement (21V560000) held, 0 fire complaints against 5 in the year before (p = 0.031). The simulated follow-up stays for the demo scenarios, labelled.

Simulated by design, and presented that way: VoltRide as the blind-test bench, ERP holds and notices as drafts, Watch replaying history.

## Nemotron, before recording

- [x] Key added to `.env.local` (works on free credits)
- [x] Every call tested live: `npm run nemotron:check`
- [ ] Upload a real burnt-connector photo in the app and check the bounding box
- [ ] One warm-up run with `NEMOTRON_THINKING_DEADLINE_MS=60000` so the cache holds thinking traces, then record
- [ ] Run five or more random scenarios live so the Scoreboard has entries

## Zetaris

- [x] Done Oct 26 (see Make it real, item 1): `npm run zetaris:check` shows **parity OK**, and the app's top bar shows **Zetaris cloud · parity ok**.
- [ ] Bonus: put the silos in different sources and map them with `ZETARIS_TABLE_MAP`

## Ship

- [x] `npm test` passes
- [x] Deployed on one long-running server at https://traceon.netlayerlabs.com, with memory, shared cases, uploads and the signing key kept on disk
- [ ] Set `TRACEON_SIGNING_KEY` on the host so the public key stays the same across deploys
- [ ] Test the live URL from a phone and a second laptop, including `/backtest`, `/watch` and a shared case link
- [ ] Record the 2-minute video ([DEMO_SCRIPT.md](DEMO_SCRIPT.md)), plus a backup take in offline mode
- [ ] Add the demo video link to the README (line 7)
- [ ] Submit before Oct 27, 23:45 UTC

## Later (after the hackathon)

- Authentication and per-team storage for uploads, shared cases and comments
- Real follow-up on arriving claims for uploaded data, reopening the case automatically
- Watch mode on a live warranty feed; continuous factors alongside categorical ones
- Upgrade OpenTimestamps proofs after Bitcoin confirmation and verify them in the app
