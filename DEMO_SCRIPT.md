# Traceon: 2-minute demo script

**Before recording:** click **Reset demo**. Set `DEMO_PACING_MS=500` for a slightly slower, more watchable run. If you have an NVIDIA key, set it so the chips read *Nemotron live*.

---

**0:00–0:15 · The problem** (show the hero screen)
> "125 thermal claims on an e-bike battery. Customers blame the heat, the firmware, the shipping. A blanket recall costs $4.5 million. Which is it?"

**0:15–0:30 · Signals** (click **Run investigation**, point at the left pane)
> "Traceon pulls warranty claims, web reviews and live CPSC, FDA and NHTSA feeds. Meterless H-MEM converges 131 weak signals from six cities into one cluster. Nemotron Super VL reads a real NTSB photo of a lithium-ion pack after thermal runaway and finds the fire started inside the cells."

**0:30–1:00 · Explain why** (watch the graph; this is the core of Track 02)
> "Nemotron ranks seven suspects, and each one is tested with SQL across the Zetaris federated silos. Firmware and carrier are ruled out: flat failure rates. Now watch: heat, the plant, the BMS board and the supplier all look guilty on raw data."
> "But when we hold the cell batch fixed, their effect disappears. They're confounders. The bad batch was built in Plant 2 and shipped to Phoenix and Austin. Only batch CB-B-0917 survives every adjustment."

Click the **Sun Belt heat** node. Show the SQL, the rows, and *holding cell_batch fixed → p = 0.23*.

**1:00–1:20 · The agent attacks itself** (scroll to Red team and the subgroup table)
> "A red-team pass challenges the verdict: maybe it's chance, maybe older units, maybe the whole supplier. Every objection is answered by a test, not by the model's opinion. The effect holds in every firmware, carrier, climate and warehouse subgroup."

**1:20–1:35 · Early warning** (show the replay chart)
> "Replaying history: this was detectable on October 10th, after just three claims. 113 later incidents were preventable."

**1:35–1:55 · Act, with a human** (right pane)
> "The evidence gate passes 7 of 7. Only then can a human approve. 1,380 units quarantined instead of 180,000: $4.47 million saved. Stop-sale notice and CPSC draft generated. And every number in the explanation was verified against the evidence."

Type an approver name, click **Execute**, then click **Replay & verify**.

**Optional 15 s · "Is it rigged?"** (if time allows, or as a second clip)
> "Fair question: did we plant the answer? Here's a random hidden scenario." Pick **Random hidden scenario**, run it, and point at the reveal card: "It found a plant defect this time, and flagged the batch as a confounder. Across 250 held-out hidden scenarios it's 250 for 250. With no defect at all, it refuses to recall."

**Optional clips** (a second video, or swap one in if a section runs short)
- **Real recalls, 15 s** (`/backtest`): "Is this only a simulation? Here is public NHTSA data. The same kind of signal test, replayed day by day, flags the Chevy Bolt's battery fires on October 30th, 2020, two weeks before GM's recall." Point at the signal and recall markers, then the three fire complaints that came first.
- **Ask the case, 10 s**: in Case tools, click *Why is the Sun Belt heat ruled out?* "Answers come only from the exhibits. It cites E-18, the test that holds the batch fixed, and every figure is checked." Click the citation.
- **Verify the fix, 10 s**: after approval, click *After the wrong fix*. "If we had blamed the heat, thirty days later the batch would still be failing, and the case reopens. The real fix verifies."
- **Watch, 10 s** (`/watch`, *Start watching*): "Run as a daily screen, it fires on October 11th after 13 claims and opens the case on that day's data."

**1:55–2:00 · Close**
> "Every claim is backed by a hashed, replayable query. Traceon doesn't just answer. It proves why."

---

### Backup plan
- No network: the federal feeds show *unreachable* and everything else runs offline.
- No NVIDIA key: every model step falls back to a labeled template, and the statistics are identical.
- `/app?autorun=1` starts the run without a click.
- The backtest runs on NHTSA snapshots bundled in the repo, so it works without network.
