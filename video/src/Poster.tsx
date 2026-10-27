import React from "react";
import { AbsoluteFill } from "remotion";
import { C, mono, sans, serif } from "./theme";
import { Brackets } from "./ui/Brackets";
import { Logo, type LogoName } from "./ui/Logo";
import { R } from "./scenes/common";

/** YouTube thumbnail: big words, one hero (the cause, locked), the logo. Readable at small size. */
export const Poster: React.FC = () => {
  const c = R.reference.cause;
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: sans, color: C.ink }}>
      <div style={{ position: "absolute", left: 110, top: 90 }}><Logo name="traceon" height={92} /></div>
      <div style={{ position: "absolute", left: 110, top: 300, width: 980, fontWeight: 600, fontSize: 128, letterSpacing: "-0.05em", lineHeight: 0.98 }}>
        Prove the <span style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 400, color: C.signal }}>cause</span> before you recall.
      </div>
      <div style={{ position: "absolute", left: 1180, top: 330, width: 620, height: 400, borderRadius: 18, background: C.ink, color: C.paper, padding: "40px 44px" }}>
        <div style={{ fontFamily: mono, fontSize: 24, letterSpacing: "0.14em", color: "rgba(242,239,231,0.6)" }}>THE CAUSE</div>
        <div style={{ marginTop: 18, fontFamily: mono, fontWeight: 600, fontSize: 92, color: C.signalHi }}>{c.group}</div>
        <div style={{ marginTop: 14, fontWeight: 600, fontSize: 120, letterSpacing: "-0.05em", lineHeight: 1 }}>{Math.round(c.rr).toLocaleString("en-US")}×</div>
        <div style={{ marginTop: 10, fontSize: 30, color: "rgba(242,239,231,0.75)" }}>4 look-alike suspects ruled out</div>
      </div>
      <Brackets box={{ x: 1180, y: 330, w: 620, h: 400 }} lock={1} color={C.signal} stroke={10} arm={70} gap={0} />
      <div style={{ position: "absolute", left: 110, top: 610, width: 980, fontSize: 40, lineHeight: 1.25, color: "rgba(26,23,20,0.72)" }}>
        An AI agent that finds why products catch fire, and proves it.
      </div>
      <div style={{ position: "absolute", left: 110, right: 110, top: 880, height: 1, background: C.rule }} />
      <div style={{ position: "absolute", left: 110, right: 110, top: 920, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: mono, fontSize: 24, letterSpacing: "0.12em", color: C.muted }}>OPEN AGENT HACKATHON 2026 · TRACK 02</span>
        <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
          {(["zetaris", "meterless", "nvidia"] as LogoName[]).map((n) => <Logo key={n} name={n} height={n === "meterless" ? 30 : n === "zetaris" ? 50 : 40} />)}
        </div>
      </div>
    </AbsoluteFill>
  );
};
