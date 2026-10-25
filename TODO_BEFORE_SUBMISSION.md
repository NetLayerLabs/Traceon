# Before submission: Oct 27, 2026, 23:45 UTC

These two paths are the biggest remaining risks. Both need you, because they need your accounts.

## 1. Nemotron live run (top priority)

Every model step has only ever run on the offline templates. The 120B vision model with thinking turned on could take 20–60 s per call, and there are four calls per run, which could make the demo crawl.

- [x] Key added to `.env.local` (works on free credits)
- [x] Every call tested live (vision, planning, red team, explanation): `npm run nemotron:check`
- [x] Fixed: wrong fast model (not on this account), thinking using up the token budget, transient NIM 500s, duplicated answers, red-team mislabeling
- [x] Thinking raced against a fast answer, so latency spikes can't stall the demo; replies cached for instant re-runs
- [ ] Upload a real burnt-connector photo in the app and check the bounding box
- [ ] Before recording: one warm-up run with `NEMOTRON_THINKING_DEADLINE_MS=60000` so the cache holds thinking traces, then record

## 2. Zetaris (the Zetaris CTO is a judge)

A parity check passing against a real Zetaris instance is worth more than any feature. Full guide: [docs/ZETARIS_SETUP.md](docs/ZETARIS_SETUP.md).

- [ ] Sign in at https://cloud.enterprise.zetaris.com/login (OTP sent to your hackathon email)
- [ ] Create the Mini Template cluster (needs an AWS account) or run the local Docker version (`colima start` first)
- [ ] `npm run zetaris:export`, then upload the 5 CSVs from `exports/zetaris/` into a database named `traceon`
- [ ] Ask Zetaris support: which API host, where to find your org ID, how to create an API token
- [ ] Set `ZETARIS_API_URL`, `ZETARIS_ORG_ID` and `ZETARIS_API_TOKEN` in `.env.local`
- [ ] `npm run zetaris:check` shows **parity OK**, and the app's top bar shows **Zetaris cloud · parity ✓**
- [ ] Bonus: put the silos in different sources and map them with `ZETARIS_TABLE_MAP`

## 3. Then

- [ ] `npm test` passes
- [ ] Deploy to Railway, Render or Fly (not Vercel), then test the live URL from a phone and a second laptop
- [ ] Record the 2-minute video with the live Nemotron run ([DEMO_SCRIPT.md](DEMO_SCRIPT.md)), plus a backup take in offline mode
- [ ] Submit before Oct 27, 23:45 UTC
