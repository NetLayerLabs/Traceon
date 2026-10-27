import React from "react";
import { interpolate } from "remotion";
import { C, mono, sans, serif } from "../theme";
import { clamp, expo, pop } from "../ui/motion";
import { Brackets } from "../ui/Brackets";
import { Count } from "../ui/Count";
import { Words } from "../ui/Words";
import { Fill, In, Kicker, Note, R, day, ease, useCue } from "./common";

/** Real data: public NHTSA complaints for the Chevy Bolt EV, then every Backblaze drive of Q2 2026. */
export const Real: React.FC = () => {
  const { f, rel } = useCue("real");
  const tNo = rel("No."), tOct = rel("October"), tWeeks = rel("weeks"), tSoft = rel("software"), tOn = rel("on."), tBatt = rel("battery"), tStop = rel("stopped.");
  const tAnd = rel("And"), tHard = rel("hard"), tCohort = rel("cohort,"), tRefuse = rel("refuses");
  const b = R.bolt, bb = R.backblaze;
  const q = Object.entries(b.quarters);
  const maxQ = Math.max(...q.map(([, v]) => v), 1);
  const swap = ease(f, tAnd - 10, 20);
  // Bolt chart geometry
  const cx = 140, cy = 380, cw = 980, chh = 380, bw = cw / q.length;
  const fu = b.followUp;
  // The alert sits in 2020 Q4, in its first month (30 Oct); the recall in its second (13 Nov).
  const xAlert = cx + bw * 1 + bw * (29 / 92), xRecall = cx + bw * 1 + bw * (43 / 92);
  return (
    <Fill tone="light">
      <div style={{ opacity: 1 - swap }}>
        <div style={{ position: "absolute", left: cx, top: 92 }}>
          <In at={0}><Kicker color="rgba(26,23,20,0.55)">Real data · public NHTSA complaints · Chevrolet Bolt EV</Kicker></In>
          <div style={{ marginTop: 16, fontFamily: sans, fontWeight: 500, fontSize: 64, letterSpacing: "-0.04em", color: C.ink }}>
            <Words text="Is it only a simulation? No." at={rel("Is") - 2} every={3} accent={{ "No.": C.signal }} />
          </div>
        </div>
        {/* fire complaints by quarter */}
        {q.map(([name, v], i) => {
          const h = (v / maxQ) * (chh - 60) * ease(f, 8 + i * 3, 18);
          return (
            <React.Fragment key={name}>
              <div style={{ position: "absolute", left: cx + i * bw + 16, top: cy + chh - h, width: bw - 32, height: h, background: i === 1 || i === 4 ? C.signal : "rgba(26,23,20,0.22)" }} />
              <div style={{ position: "absolute", left: cx + i * bw, top: cy + chh - h - 34, width: bw, textAlign: "center", fontFamily: mono, fontSize: 20, color: C.ink, opacity: ease(f, 14 + i * 3, 12) }}>{v}</div>
              <div style={{ position: "absolute", left: cx + i * bw, top: cy + chh + 12, width: bw, textAlign: "center", fontFamily: mono, fontSize: 15, color: C.muted }}>{name}</div>
            </React.Fragment>
          );
        })}
        <div style={{ position: "absolute", left: cx, top: cy + chh, width: cw, height: 2, background: "rgba(26,23,20,0.3)" }} />
        <div style={{ position: "absolute", left: cx, top: cy + chh + 46, fontFamily: mono, fontSize: 14, letterSpacing: "0.1em", color: C.muted }}>FIRE COMPLAINTS FILED, BY QUARTER</div>
        {/* the alert and the recall: 14 days apart, so their labels stack above the chart */}
        <div style={{ position: "absolute", left: xAlert - 1, top: cy - 96, width: 3, height: chh + 96, background: C.signal, opacity: ease(f, tOct - 4, 10) }} />
        <div style={{ position: "absolute", left: xRecall - 1, top: cy - 44, width: 3, height: chh + 44, background: C.ink, opacity: ease(f, tWeeks - 4, 10) }} />
        <div style={{ position: "absolute", left: xAlert + 14, top: cy - 112, width: 460, fontFamily: sans, fontSize: 22, color: C.signal, opacity: ease(f, tOct, 12) }}>
          {day(b.alert!.date)} · <span style={{ fontWeight: 600 }}>Traceon’s screen fires</span>
        </div>
        <div style={{ position: "absolute", left: xRecall + 14, top: cy - 60, width: 420, fontFamily: sans, fontSize: 22, color: C.ink, opacity: ease(f, tWeeks, 12) }}>
          {day(b.recall!.date)} · <span style={{ fontWeight: 600 }}>Recall {b.recall!.campaign}</span>
        </div>
        <Brackets box={{ x: xAlert + 4, y: cy - 120, w: 372, h: 44 }} lock={ease(f, tOct - 4, 14)} release={ease(f, tSoft - 8, 14)} color={C.signal} stroke={3} arm={14} gap={30} />
        <div style={{ position: "absolute", left: cx + 5 * bw + 10, top: cy + 40, width: 360, fontFamily: sans, fontWeight: 600, fontSize: 56, letterSpacing: "-0.04em", lineHeight: 1, color: C.signal, opacity: ease(f, tWeeks + 6, 12) }}>
          {b.leadDays} days early
          <div style={{ fontFamily: mono, fontWeight: 400, fontSize: 15, lineHeight: 1.5, letterSpacing: "0.08em", color: C.muted, marginTop: 10 }}>ON {b.alert!.cases} FIRE COMPLAINTS, THE DAY<br />COMPLAINT {R.bolt.quotes[0].odi} WAS FILED</div>
        </div>
        {/* did the fix hold? */}
        <div style={{ position: "absolute", left: 1180, top: 250, width: 620 }}>
          <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: C.muted, opacity: ease(f, tSoft - 8, 10) }}>DID THE FIX HOLD? YEAR BEFORE VS THE YEAR FROM 90 DAYS AFTER</div>
          {fu.map((x, i) => {
            const at = i ? tBatt - 4 : tSoft - 4;
            const held = x.verdict === "held";
            const p = pop(f, at);
            return (
              <div key={x.campaign} style={{ marginTop: 16, background: C.sheet, borderRadius: 12, padding: "18px 22px", boxShadow: "0 0 0 1px rgba(26,23,20,0.1)", borderLeft: `5px solid ${held ? C.ok : C.ochre}`, opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 18}px)` }}>
                <div style={{ fontFamily: mono, fontSize: 16, color: C.muted }}>RECALL {x.campaign} · {day(x.date).toUpperCase()}</div>
                <div style={{ marginTop: 6, fontFamily: sans, fontSize: 25, color: C.ink }}>{i ? "Battery replacement" : "Software fix"}</div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 16 }}>
                  <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 54, letterSpacing: "-0.04em", color: C.ink }}>{x.before} → {x.after}</span>
                  <span style={{ fontFamily: sans, fontSize: 21, color: C.muted }}>fire complaints</span>
                </div>
                <div style={{ marginTop: 4, fontFamily: serif, fontStyle: "italic", fontSize: 26, color: held ? C.ok : C.ochre, opacity: ease(f, (i ? tStop : tOn) - 2, 10) }}>
                  {held ? `held (p = ${x.p.toFixed(3)})` : "did not hold"}
                </div>
              </div>
            );
          })}
        </div>
        <Note color="rgba(26,23,20,0.45)" size={13} style={{ position: "absolute", left: cx, top: 880 }}>SOURCE: API.NHTSA.GOV, COMPLAINTS AND RECALLS FOR THE 2017-2019 BOLT EV, FETCHED {day(b.fetchedAt).toUpperCase()}</Note>
      </div>

      {/* Backblaze: every drive of Q2 2026 */}
      <div style={{ opacity: swap }}>
        <div style={{ position: "absolute", left: cx, top: 92 }}>
          <Kicker color="rgba(26,23,20,0.55)">Real data · Backblaze Drive Stats · Q2 2026</Kicker>
          <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 22 }}>
            <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 104, letterSpacing: "-0.05em", lineHeight: 1, color: C.ink }}><Count to={bb.drives} at={tAnd + 4} dur={30} /></span>
            <span style={{ fontFamily: sans, fontSize: 32, color: C.muted }}>real hard drives · {bb.failures.toLocaleString("en-US")} failures</span>
          </div>
        </div>
        {[
          { label: `${bb.worstModel} in data centre sac2`, v: bb.worstInSac2.per10k, hot: true },
          { label: `${bb.worstModel} everywhere else`, v: bb.worstElsewhere.per10k },
          { label: "All other drives in sac2", v: bb.othersInSac2.per10k },
          { label: "All other drives everywhere else", v: bb.othersElsewhere.per10k },
        ].map((r, i) => {
          const w = (r.v / bb.worstInSac2.per10k) * 860 * ease(f, tHard + i * 4, 20);
          return (
            <div key={r.label} style={{ position: "absolute", left: cx, top: 330 + i * 110 }}>
              <div style={{ fontFamily: sans, fontSize: 24, color: C.ink }}>{r.label}</div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 18 }}>
                <div style={{ height: 40, width: w, background: r.hot ? C.signal : "rgba(26,23,20,0.22)" }} />
                <span style={{ fontFamily: mono, fontSize: 24, color: r.hot ? C.signal : C.ink }}>{Math.round(r.v)} per 10,000</span>
              </div>
            </div>
          );
        })}
        <Brackets box={{ x: cx - 16, y: 316, w: 1180, h: 104 }} lock={ease(f, tCohort - 4, 14)} color={C.signal} stroke={3} arm={18} gap={30} />
        <div style={{ position: "absolute", left: 1420, top: 470, width: 400, opacity: ease(f, tRefuse - 4, 14) }}>
          <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: C.muted }}>EVIDENCE GATE</div>
          <div style={{ marginTop: 8, fontFamily: sans, fontWeight: 600, fontSize: 48, letterSpacing: "-0.03em", color: C.signal }}>Blocked</div>
          <div style={{ marginTop: 8, fontFamily: sans, fontSize: 24, lineHeight: 1.3, color: C.ink }}>No fleet-wide action on the model: the failures sit in one cohort, where it meets sac2.</div>
        </div>
        <Note color="rgba(26,23,20,0.45)" size={13} style={{ position: "absolute", left: cx, top: 880 }}>SOURCE: BACKBLAZE DRIVE STATS, Q2 2026 (PUBLIC), EVERY DRIVE IN THE FLEET</Note>
      </div>
    </Fill>
  );
};
