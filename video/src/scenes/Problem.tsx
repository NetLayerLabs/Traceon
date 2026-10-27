import React from "react";
import { interpolate, random } from "remotion";
import { C, mono, sans, serif } from "../theme";
import { clamp, expo, pop, soft } from "../ui/motion";
import { Brackets, type Box } from "../ui/Brackets";
import { Count } from "../ui/Count";
import { Trace } from "../ui/Trace";
import { Words } from "../ui/Words";
import { Fill, In, Kicker, Note, R, SIM, ease, useCue } from "./common";

const SOURCES = [
  { word: "claims,", title: "Warranty claims", sub: "the CRM" },
  { word: "reviews,", title: "Reviews and forums", sub: "the open web" },
  { word: "federal", title: "Federal reports", sub: "CPSC · NHTSA · FDA" },
  { word: "factory", title: "Factory records", sub: "ERP · suppliers" },
];
/** The suspects of the reference case, in the order the brackets hunt them. */
const SUSPECTS = ["Heat", "Plant", "Cell supplier", "BMS board", "Firmware", "Carrier"];

/** The trail is split; the first suspect is often wrong; the safe move is to recall everything. */
export const Problem: React.FC = () => {
  const { f, rel } = useCue("problem");
  const tFirst = rel("first"), tWrong = rel("wrong."), tFix = rel("Fix"), tRecall = rel("Recall"), tPay = rel("pay");
  const topOut = interpolate(f, [tRecall - 16, tRecall - 2], [1, 0], clamp);
  const field = ease(f, tRecall - 6, 24);

  // Suspect chips along a row; the brackets hunt left to right, never settle, then let go of heat.
  const chipW = 230, chipH = 86, gap = 26, x0 = 160, y0 = 560;
  const box = (i: number): Box => ({ x: x0 + i * (chipW + gap), y: y0, w: chipW, h: chipH });
  const hops = [tFirst - 2, tFirst + 12, tFirst + 22, tFirst + 32, tWrong - 4];
  const order = [0, 1, 2, 1, 0];
  let hb = box(0);
  for (let k = 1; k < hops.length; k++) {
    const t = interpolate(f, [hops[k - 1], hops[k]], [0, 1], { ...clamp, easing: soft });
    const a = box(order[k - 1]), b = box(order[k]);
    if (f >= hops[k - 1]) hb = { x: a.x + (b.x - a.x) * t, y: a.y, w: chipW, h: chipH };
  }
  const huntLock = ease(f, tFirst - 6, 14);
  const letGo = ease(f, tWrong + 2, 18);

  // "Fix the wrong thing, and the fires go on": incidents keep landing after the fix marker.
  const fixX = 1360;
  const incidents = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: 1290 + i * 64 + (i > 1 ? 40 : 0), at: tFix + (i < 2 ? -30 + i * 8 : 6 + (i - 2) * 7) }));

  // 180,000 units as a field of 3,000 squares (60 units each), all of them recalled.
  const cols = 100, rows = 30, cell = 14, fx0 = 260, fy0 = 300;
  const blanket = R.reference.plan.blanketUnits, cost = R.reference.plan.blanketCostUsd;

  return (
    <Fill tone="light">
      <div style={{ opacity: topOut }}>
        <div style={{ position: "absolute", left: 160, top: 96 }}>
          <In at={2}><Kicker color="rgba(26,23,20,0.55)">The problem</Kicker></In>
          <div style={{ marginTop: 22, fontFamily: sans, fontWeight: 500, fontSize: 84, letterSpacing: "-0.045em", lineHeight: 1.02 }}>
            <Words text="Every fire leaves a trail." at={rel("Every") - 2} every={3} accent={{ "trail.": C.signal }} />
          </div>
        </div>
        {/* the split trail */}
        <Trace d="M160,420 L1760,420" p={ease(f, rel("trail,") - 8, 30)} color="rgba(26,23,20,0.18)" width={2} />
        {SOURCES.map((s, i) => {
          const t = rel(s.word) - 4;
          const p = pop(f, t);
          const x = 160 + i * 410;
          return (
            <div key={s.title} style={{ position: "absolute", left: x, top: 372, width: 370, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 24}px)` }}>
              <div style={{ background: C.sheet, borderRadius: 12, padding: "16px 20px", boxShadow: "0 0 0 1px rgba(26,23,20,0.1), 0 18px 40px rgba(60,40,20,0.1)", borderLeft: `4px solid ${C.signal}` }}>
                <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 25, letterSpacing: "-0.01em" }}>{s.title}</div>
                <div style={{ marginTop: 4, fontFamily: mono, fontSize: 15, letterSpacing: "0.08em", color: C.muted }}>{s.sub.toUpperCase()}</div>
              </div>
            </div>
          );
        })}
        {/* the suspects */}
        <div style={{ position: "absolute", left: 160, top: 486, fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: C.muted, opacity: ease(f, tFirst - 10, 12) }}>
          SUSPECTS THAT LOOK GUILTY ON RAW NUMBERS
        </div>
        {SUSPECTS.map((name, i) => {
          const b = box(i);
          const p = pop(f, tFirst - 12 + i * 3);
          const dead = i === 0 ? letGo : 0;
          return (
            <div key={name} style={{
              position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: sans, fontWeight: 500, fontSize: 28, letterSpacing: "-0.01em", background: dead ? C.ochreSoft : C.sheet, color: dead ? C.ochre : C.ink,
              boxShadow: "0 0 0 1px rgba(26,23,20,0.1)", opacity: Math.min(1, p * 1.3), transform: `scale(${0.9 + 0.1 * p})`,
              textDecoration: dead > 0.5 ? "line-through" : undefined,
            }}>{name}</div>
          );
        })}
        <Brackets box={hb} lock={huntLock} release={letGo} color={C.signal} releaseColor={C.ochre} stroke={4} arm={24} gap={40} />
        {/* the fires go on */}
        <div style={{ position: "absolute", left: 160, top: 712, fontFamily: sans, fontSize: 38, letterSpacing: "-0.02em", color: "rgba(26,23,20,0.82)" }}>
          <Words text="Fix the wrong thing, and the fires go on." at={tFix - 2} every={3} accent={{ "on.": C.signal }} />
        </div>
        <div style={{ position: "absolute", left: fixX - 2, top: 694, width: 3, height: 110, background: C.ochre, opacity: ease(f, tFix, 10) }} />
        <div style={{ position: "absolute", left: fixX + 12, top: 690, fontFamily: mono, fontSize: 14, letterSpacing: "0.12em", color: C.ochre, opacity: ease(f, tFix, 10) }}>FIX</div>
        {incidents.map((n, i) => (
          <div key={i} style={{ position: "absolute", left: n.x, top: 752, width: 26, height: 26, background: C.signal, transform: `scale(${pop(f, n.at)})`, opacity: f >= n.at ? 1 : 0 }} />
        ))}
      </div>

      {/* Recall everything */}
      <div style={{ opacity: field }}>
        <div style={{ position: "absolute", left: 160, top: 120, fontFamily: sans, fontWeight: 500, fontSize: 74, letterSpacing: "-0.045em", lineHeight: 1.04 }}>
          <Words text="Recall everything, and you pay for all of it." at={tRecall} every={3} accent={{ "all": C.signal }} />
        </div>
        <svg style={{ position: "absolute", left: 0, top: 0 }} width={1920} height={1080}>
          {Array.from({ length: cols * rows }, (_, i) => {
            const c = i % cols, r = Math.floor(i / cols);
            const t = tRecall + 4 + (c / cols) * 26 + random(`d${i}`) * 10;
            const on = interpolate(f, [t, t + 6], [0, 1], clamp);
            return <rect key={i} x={fx0 + c * cell} y={fy0 + r * cell} width={cell - 4} height={cell - 4} fill={on > 0.5 ? C.signal : "rgba(26,23,20,0.16)"} opacity={0.35 + 0.65 * ease(f, tRecall - 6 + r * 0.4, 18)} />;
          })}
        </svg>
        <div style={{ position: "absolute", left: 260, top: 760, display: "flex", gap: 70, alignItems: "baseline" }}>
          <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 64, letterSpacing: "-0.04em", color: C.signal }}>
            <Count to={blanket} at={tRecall + 4} dur={34} /> <span style={{ fontSize: 30, fontWeight: 500, color: C.ink }}>units recalled</span>
          </div>
          <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 64, letterSpacing: "-0.04em" }}>
            <Count to={cost} at={tPay - 6} dur={30} prefix="$" />
          </div>
        </div>
        <Note color="rgba(26,23,20,0.5)" size={14} style={{ position: "absolute", left: 260, top: 856 }}>{SIM} · $25 A PACK</Note>
      </div>
    </Fill>
  );
};
