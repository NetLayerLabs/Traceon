# Traceon demo film

A film of about 3:50 made with [Remotion](https://www.remotion.dev) for the judges of the Open Agent Hackathon 2026 (Track 02: The Agent That Can Explain Why). It opens on a real Chevy Bolt EV fire and the recall whose fix did not hold, then the problem, why Zetaris, why Traceon, the product working for real, real data, the proof, and what makes it different.

Deliverables: `out/traceon-demo-4k.mp4` and `out/traceon-thumbnail.png`. YouTube title, description and chapters: `youtube.txt`.

## What is real

- **The cold open and the real-data scene.** Two public NHTSA complaints, quoted verbatim and fetched from api.nhtsa.gov: ODI 11372429 (fire of 21 Oct 2020, filed 30 Oct 2020) and ODI 11426342 (filed 25 Jul 2021), plus recalls 20V701000 (13 Nov 2020) and 21V560000 (23 Jul 2021). The fire complaints by quarter, the 14-day lead, and the follow-up of each recall (3 fire complaints the year before 20V701000 and 6 in the year from 90 days after; 5 and 0 for 21V560000, p = 0.031) are computed by the app's own engine (`src/lib/realRecall.ts`) from the snapshot in `data/nhtsa/`.
- **Backblaze.** Every drive Backblaze ran in Q2 2026 (public Drive Stats): 355,689 drives and 1,517 failures, the worst model HGST HUH721212ALN604 and its rates in data centre sac2 and elsewhere, from `public/samples/backblaze-drives-q2-2026.csv` through the app's engine.
- **The reference case** (VoltRide, the VR-48 pack) is a simulated company with planted defects. Every scene that shows it says so on screen. Its figures (131 signals in six cities, seven suspects, raw and adjusted p-values, 1,668x, 92.8% of incidents, 1,380 units, $4,465,500) come from the engine.
- All of the above are read into `data/real.json` by `scripts/data.mts`, never typed by hand. The figures of the recorded runs (queries on Zetaris, run time, parity, proof root, provider labels, the number check, red-team objections) are written to `data/live.json` by `scripts/capture.mjs`.
- **The app footage** is the real app, recorded headless at 1600x900 (device scale 2) by `scripts/capture.mjs`:
  - the production site, https://traceon.netlayerlabs.com, with Zetaris live: one reference investigation, one exhibit opened and one "Replay & verify" (no approvals on production);
  - this Mac, with Meterless Nightshift as the AI provider: one investigation and one surgical-quarantine approval by "VP Quality" (the app's own placeholder role), on a local server with its own storage;
  - the Meterless Nightshift app's own window, captured with `screencapture -l` while that run went through it (its status bar counts the requests it serves).
- **Logos** are the real ones, unaltered: Traceon's own, Zetaris, NVIDIA and GenAI.works (official site files), Meterless (its mark and wordmark, from meterless.ai's own SVG), Bright Data (its logo, from brightdata.com) and NetLayer Labs.
- **Narration, music and sound** are ElevenLabs. The narrator is Daniel; the owner's quoted complaint is read by River. The score is ElevenLabs Music in five parts spliced on scene cuts; the effects are ElevenLabs sound generation.

## Build it

The ElevenLabs key is read at runtime from `/Users/mrnetwork/Syntura/video/.env` and never stored here.

```
npm install
npm run data                                   # real figures -> data/real.json
npm run vo && npm run timing && npm run music && npm run sfx && npm run timing
ONLY=run_live,proof_live npm run capture       # production site (Zetaris live)
ONLY=nightshift_local,act_local LOCAL=http://127.0.0.1:3821 npm run capture   # this Mac (Nightshift)
npm run encode
npm run studio                                 # preview
npm run draft                                  # half-scale check render
npm run render4k && npm run finish             # 4K master, -14 LUFS
```

`script.json` holds every spoken line (`say` spells a word the way it is pronounced); `src/timing.json` places each word on the frame it is spoken, and the scenes animate on those words. The film never ships with the app: the app's tsconfig excludes `video/`, and `.gitattributes` keeps it out of `git archive` deploys.
