import React from "react";
import { interpolate } from "remotion";
import { C, mono, sans, serif } from "../theme";
import { clamp, expo, pop } from "../ui/motion";
import { Brackets } from "../ui/Brackets";
import { Trace } from "../ui/Trace";
import { Words } from "../ui/Words";
import { Fill, In, Kicker, Note, R, day, ease, useCue } from "./common";

const quote = (odi: string) => R.bolt.quotes.find((q) => q.odi === odi)!;
const FIRE = quote("11372429");
const OWNER = quote("11426342");
// The excerpt shown is verbatim from the complaint; the cut is marked with an ellipsis.
const OPENING = FIRE.text!.slice(0, FIRE.text!.indexOf("WE STARTED")).trim();
const FOUND = "WE FOUND THAT THE CHEVY BOLT WAS ON FIRE AND THERE WAS LOT OF SMOKE IN THE GARAGE.";
const OWNER_LINE = "This is the second recall in less than a year for the same battery-related issue.";
const FIRST = R.bolt.recalls.find((r) => r.campaign === "20V701000")!;
const SECOND = R.bolt.recalls.find((r) => r.campaign === "21V560000")!;

/** Real moment: complaint 11372429 (fire of 21 Oct 2020), the recall two weeks after it was filed, the owner who wrote eight months on. */
export const Open: React.FC = () => {
  const { f, rel, dur } = useCue("open");
  if (!FIRE.text!.includes(FOUND) || !OWNER.text!.includes(OWNER_LINE)) throw new Error("quoted complaint text changed");
  const tThree = rel("Three"), tFamily = rel("family"), tTheir = rel("Their"), tBurn = rel("burning");
  const tThey = rel("They"), tRecalls = rel("recalls"), tSoft = rel("software"), tEight = rel("Eight"), tOwner = rel("This");
  // Phase A: date and the clock; Phase B: the record types in; Phase C: the timeline; Phase D: the owner's words.
  const recordIn = ease(f, tTheir - 10, 20);
  const typed = interpolate(f, [tTheir - 6, tBurn + 6], [0, 1], clamp);
  const leftOut = interpolate(f, [tOwner - 24, tOwner - 4], [1, 0], clamp);
  const recordOut = interpolate(f, [tOwner - 20, tOwner - 2], [1, 0], clamp);
  const ownerIn = ease(f, tOwner - 6, 22);
  const alarm = f > tFamily ? 0.5 + 0.5 * Math.sin((f - tFamily) / 3.2) : 0;
  const alarmOn = interpolate(f, [tFamily + 6, tFamily + 14, tTheir + 30, tTheir + 50], [0, 1, 1, 0], clamp);

  // The trace: fire -> reported -> recall -> second recall -> owner writes.
  const Y = 836;
  const nodes = [
    { x: 190, at: tTheir - 6, date: day(FIRE.incident!), what: "Fire in the garage", lock: tBurn },
    { x: 560, at: tThey, date: day(FIRE.filed!), what: "Reported to NHTSA", lock: -1 },
    { x: 930, at: tRecalls - 2, date: day("2020-11-13"), what: `Recall ${FIRST.campaign}`, tag: "fix: a software update", lock: -1 },
    { x: 1360, at: tEight + 4, date: day("2021-07-23"), what: `Recall ${SECOND.campaign}`, lock: -1 },
    { x: 1730, at: tEight + 16, date: day(OWNER.filed!), what: "An owner writes", lock: -1 },
  ];
  const lineP = (i: number) => interpolate(f, [nodes[i].at - 14, nodes[i].at], [0, 1], { ...clamp, easing: expo });
  const d = nodes.slice(1).map((n, i) => `M${nodes[i].x},${Y} L${n.x},${Y}`);
  const timelineIn = ease(f, tTheir - 14, 20);

  return (
    <Fill tone="dark">
      {/* the alarm: a slow red breath at the edges */}
      <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 0 ${220 + 120 * alarm}px rgba(194,61,23,${0.42 * alarm * alarmOn})` }} />

      {/* Phase A: the date and the hour */}
      <div style={{ position: "absolute", left: 130, top: 150, width: 820, opacity: leftOut }}>
        <In at={2}><Kicker>A real case · NHTSA complaint {FIRE.odi}</Kicker></In>
        <div style={{ marginTop: 34, fontFamily: sans, fontWeight: 500, fontSize: 112, letterSpacing: "-0.045em", lineHeight: 1, color: C.paper }}>
          <Words text="21 October 2020" at={rel("October") - 4} every={5} />
        </div>
        <div style={{ marginTop: 26, display: "flex", alignItems: "baseline", gap: 26 }}>
          <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 92, color: C.signalHi, letterSpacing: "0.02em", opacity: ease(f, tThree - 4, 14) }}>
            03<span style={{ opacity: Math.floor(f / 15) % 2 ? 0.25 : 1 }}>:</span>00
          </span>
          <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 44, color: "rgba(242,239,231,0.7)", opacity: ease(f, tThree + 8, 14) }}>in the morning</span>
        </div>
        <div style={{ marginTop: 40, fontFamily: sans, fontSize: 40, letterSpacing: "-0.02em", color: "rgba(242,239,231,0.82)", lineHeight: 1.25 }}>
          <Words text="A family wakes to smoke alarms." at={tFamily - 4} every={3} accent={{ "alarms.": C.signalHi }} />
        </div>
      </div>

      {/* Phase B: the complaint, as filed */}
      <div style={{ position: "absolute", left: 1000, top: 130, width: 790, opacity: recordIn * recordOut, transform: `translateY(${(1 - recordIn) * 30}px)` }}>
        <div style={{ background: C.panel, borderRadius: 14, padding: "26px 30px 30px", boxShadow: "0 0 0 1px rgba(242,239,231,0.1), 0 40px 90px rgba(0,0,0,0.55)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 15, letterSpacing: "0.1em", color: "rgba(242,239,231,0.55)" }}>
            <span>NHTSA · ODI {FIRE.odi} · CHEVROLET BOLT EV</span><span>FIRE: YES</span>
          </div>
          <div style={{ marginTop: 6, fontFamily: mono, fontSize: 15, letterSpacing: "0.1em", color: "rgba(242,239,231,0.55)" }}>
            INCIDENT {day(FIRE.incident!).toUpperCase()} · FILED {day(FIRE.filed!).toUpperCase()}
          </div>
          <div style={{ height: 1, background: "rgba(242,239,231,0.12)", margin: "18px 0" }} />
          <div style={{ fontFamily: mono, fontSize: 22, lineHeight: 1.6, color: "rgba(242,239,231,0.78)", minHeight: 250 }}>
            {(OPENING + " …").slice(0, Math.round(typed * (OPENING.length + 2)))}
            <div style={{ marginTop: 14, color: C.paper }}>
              {f > tBurn - 10 ? (
                <span style={{ position: "relative", background: `rgba(194,61,23,${0.28 * ease(f, tBurn, 12)})` }}>{FOUND}</span>
              ) : null}
            </div>
          </div>
        </div>
        <Note color="rgba(242,239,231,0.45)" size={13} style={{ marginTop: 14 }}>VERBATIM FROM THE PUBLIC COMPLAINT · API.NHTSA.GOV</Note>
      </div>
      {f > tBurn - 10 && f < tOwner - 4 ? (
        <Brackets box={{ x: 1022, y: 322, w: 744, h: 76 }} lock={ease(f, tBurn - 6, 16)} color={C.signalHi} stroke={4} arm={26} gap={60} opacity={recordOut} />
      ) : null}

      {/* Phase D: the owner's words */}
      <div style={{ position: "absolute", left: 200, right: 200, top: 210, opacity: ownerIn, transform: `translateY(${(1 - ownerIn) * 26}px)` }}>
        <Kicker color="rgba(242,239,231,0.6)">Eight months on · NHTSA complaint {OWNER.odi} · filed {day(OWNER.filed!)}</Kicker>
        <div style={{ marginTop: 34, fontFamily: serif, fontStyle: "italic", fontWeight: 400, fontSize: 78, lineHeight: 1.16, letterSpacing: "-0.015em", color: C.paper }}>
          <Words text={`“${OWNER_LINE}”`} at={tOwner} every={3} accent={{ second: C.signalHi }} serifScale={1} />
        </div>
        <Note color="rgba(242,239,231,0.5)" style={{ marginTop: 26 }}>A BOLT EV OWNER, IN THEIR OWN WORDS. VERBATIM, API.NHTSA.GOV</Note>
      </div>

      {/* Phase C: the trace */}
      <div style={{ opacity: timelineIn }}>
        <Trace d={`M${nodes[0].x},${Y} L${nodes[4].x},${Y}`} p={1} color="rgba(242,239,231,0.12)" width={2} />
        {d.map((p, i) => <Trace key={i} d={p} p={lineP(i + 1)} color={i >= 2 ? C.signalHi : "rgba(242,239,231,0.7)"} width={3} />)}
        {nodes.map((n, i) => {
          const s = pop(f, n.at);
          const on = f >= n.at;
          return (
            <div key={i} style={{ position: "absolute", left: n.x - 120, top: Y - 14, width: 240, textAlign: "center", opacity: on ? 1 : 0.0 }}>
              <div style={{ margin: "0 auto", width: 28, height: 28, transform: `scale(${s})`, background: i === 0 || i >= 2 ? C.signal : C.paper, boxShadow: i === 0 ? `0 0 24px ${C.signal}` : undefined }} />
              <div style={{ marginTop: 14, fontFamily: mono, fontSize: 15, letterSpacing: "0.08em", color: "rgba(242,239,231,0.6)" }}>{n.date.toUpperCase()}</div>
              <div style={{ marginTop: 4, fontFamily: sans, fontWeight: 500, fontSize: 22, color: C.paper }}>{n.what}</div>
              {n.tag ? <div style={{ marginTop: 4, fontFamily: serif, fontStyle: "italic", fontSize: 21, color: C.signalHi, opacity: ease(f, tSoft, 14) }}>{n.tag}</div> : null}
            </div>
          );
        })}
      </div>
    </Fill>
  );
};
