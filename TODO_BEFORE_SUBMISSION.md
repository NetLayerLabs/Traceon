# Before submission: Oct 27, 2026, 23:45 UTC

Checklist and roadmap for the NetLayer Labs entry. The repository is [NetLayerLabs/Traceon](https://github.com/NetLayerLabs/Traceon).

## Built (as of Oct 25)

- [x] Investigation agent, evidence gate, proof chain, remediation; blind accuracy 304/304, held out 250/250
- [x] Live Nemotron for every model step, with thinking raced against a fast answer and replies cached
- [x] The 13 features beyond one case, each in the section menu or next to the evidence it uses:
  - [x] Real-recall time machine (`/backtest`): Bolt EV 14 days early, Sorento 72, Santa Fe 380
  - [x] Your data (`/data`), with a 12,000-unit sample
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

## Make it real, one at a time (in this order; finish one before starting the next)

- [ ] **1. Zetaris** ← current. You: create the account and cluster (see section 2 below). Then: `npm run zetaris:export`, upload to `traceon`, set the env vars, `npm run zetaris:check` shows parity OK. Then I export firmware, two-causes and noise as extra schemas so the named scenarios run on Zetaris too.
  - Done ahead: the client retries the 400 faults other teams hit on these clusters (`Could not create ResultSet: null`, `TTransportException`), waits up to 55 s for a cold start, and skips the cloud for 60 s if it keeps failing.
  - Before recording: run `npm run zetaris:check` a few minutes before, to warm the cluster.
  - Ask the mentor: API host, org ID and token; whether idle clusters scale down (and how to keep it warm for judging); **whether judges will run against our live cluster after the deadline, and until when it stays up**.
- [ ] **2. Intake NHTSA feed**: e-bike or e-scooter battery fire complaints with a strict fire filter, instead of Tesla Model 3 (one current match is an Autopilot complaint).
- [ ] **3. openFDA feed**: narrow to lithium-battery thermal events, or drop it.
- [ ] **4. Sample defect photo**: you pick a real, openly licensed burnt-connector photo (e.g. Wikimedia Commons) or take one; I wire it in.
- [ ] **5. Bright Data**: you add `BRIGHTDATA_API_TOKEN`; I point the scraper at the real-data case so real posts exist.
- [ ] **6. Real dataset on Your data**: Backblaze hard-drive data, reduced to one row per drive (check the size first), replacing the generated charger sample.
- [ ] **7. Real follow-up**: on the NHTSA cases, real complaints after the recall date; the simulated follow-up stays for the demo scenarios, labelled.

Simulated by design, and presented that way: VoltRide as the blind-test bench, ERP holds and notices as drafts, Watch replaying history.

## 1. Nemotron, before recording

- [x] Key added to `.env.local` (works on free credits)
- [x] Every call tested live: `npm run nemotron:check`
- [ ] Upload a real burnt-connector photo in the app and check the bounding box
- [ ] One warm-up run with `NEMOTRON_THINKING_DEADLINE_MS=60000` so the cache holds thinking traces, then record
- [ ] Run five or more random scenarios live so the Scoreboard has entries

## 2. Zetaris (the Zetaris CTO is a judge)

A parity check passing against a real Zetaris instance is worth more than any feature. Full guide: [docs/ZETARIS_SETUP.md](docs/ZETARIS_SETUP.md).

- [ ] Sign in at https://cloud.enterprise.zetaris.com/login (OTP sent to your hackathon email)
- [ ] Create the Mini Template cluster (needs an AWS account) or run the local Docker version (`colima start` first)
- [ ] `npm run zetaris:export`, then upload the 5 CSVs from `exports/zetaris/` into a database named `traceon`
- [ ] Ask Zetaris support: which API host, where to find your org ID, how to create an API token
- [ ] Set `ZETARIS_API_URL`, `ZETARIS_ORG_ID` and `ZETARIS_API_TOKEN` in `.env.local`
- [ ] `npm run zetaris:check` shows **parity OK**, and the app's top bar shows **Zetaris cloud · parity ✓**
- [ ] Bonus: put the silos in different sources and map them with `ZETARIS_TABLE_MAP`

## 3. Ship

- [x] `npm test` passes
- [ ] Deploy to Railway, Render or Fly (not Vercel), with a volume for `.meterless-data/` (memory, shared cases, uploads, signing key) and `.nim-cache/`
- [ ] Set `TRACEON_SIGNING_KEY` on the host so the public key stays the same across deploys
- [ ] Test the live URL from a phone and a second laptop, including `/backtest`, `/watch` and a shared case link
- [ ] Record the 2-minute video ([DEMO_SCRIPT.md](DEMO_SCRIPT.md)), plus a backup take in offline mode
- [ ] Replace `<LIVE_URL>` and `<VIDEO_URL>` in the README
- [ ] Submit before Oct 27, 23:45 UTC

## Later (after the hackathon)

- Authentication and per-team storage for uploads, shared cases and comments
- Real follow-up on arriving claims, reopening the case automatically
- Watch mode on a live warranty feed; continuous factors alongside categorical ones
- Upgrade OpenTimestamps proofs after Bitcoin confirmation and verify them in the app
