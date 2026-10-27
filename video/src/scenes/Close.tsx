import React from "react";
import { C, mono, sans } from "../theme";
import { pop } from "../ui/motion";
import { Logo, type LogoName } from "../ui/Logo";
import { Words } from "../ui/Words";
import { Fill, ease, useCue } from "./common";

const BUILT: LogoName[] = ["zetaris", "meterless", "nvidia", "brightdata"];

/** Logo, tagline, URL; the sponsors and the data provider; the event and the team. */
export const Close: React.FC = () => {
  const { f, rel } = useCue("close");
  const tName = rel("Traceon."), tProve = rel("Prove"), tOpen = rel("Open"), tUrl = rel("traceon.netlayerlabs.com,"), tBreak = rel("break");
  const H = 120, W = (H * 882) / 160;
  return (
    <Fill tone="light">
      <div style={{ position: "absolute", left: 960 - W / 2, top: 150, opacity: ease(f, tName - 6, 16), transform: `scale(${0.96 + 0.04 * ease(f, tName - 6, 16)})` }}>
        <Logo name="traceon" height={H} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 318, textAlign: "center", fontFamily: sans, fontWeight: 500, fontSize: 70, letterSpacing: "-0.04em", color: C.ink }}>
        <Words text="Prove the cause before you recall." at={tProve - 2} every={3} accent={{ cause: C.signal }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 452, textAlign: "center", opacity: ease(f, tUrl - 6, 14) }}>
        <div style={{ display: "inline-block", fontFamily: mono, fontWeight: 500, fontSize: 44, letterSpacing: "0.01em", color: C.ink, padding: "14px 30px", borderRadius: 12, background: C.sheet, boxShadow: "0 0 0 1px rgba(26,23,20,0.12)" }}>
          <span style={{ display: "inline-block", width: 14, height: 14, background: C.signal, marginRight: 18, verticalAlign: "middle" }} />traceon.netlayerlabs.com
        </div>
        <div style={{ marginTop: 18, fontFamily: sans, fontSize: 28, color: C.muted, opacity: ease(f, tBreak - 4, 14) }}>
          Open the case. Try to break the verdict. · github.com/NetLayerLabs/Traceon
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 690, textAlign: "center", fontFamily: mono, fontSize: 15, letterSpacing: "0.16em", color: C.muted, opacity: ease(f, tOpen, 14) }}>BUILT WITH</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 730, display: "flex", justifyContent: "center", alignItems: "center", gap: 78 }}>
        {BUILT.map((n, i) => {
          const p = pop(f, tOpen + 4 + i * 5);
          const h = n === "meterless" ? 34 : n === "nvidia" ? 46 : n === "zetaris" ? 56 : 44;
          return <div key={n} style={{ opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 16}px)` }}><Logo name={n} height={h} /></div>;
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 856, display: "flex", justifyContent: "center", alignItems: "center", gap: 26, opacity: ease(f, tBreak + 6, 16) }}>
        <span style={{ fontFamily: sans, fontSize: 22, color: C.muted }}>Open Agent Hackathon 2026 · Track 02: The Agent That Can Explain Why</span>
        <Logo name="genai" height={26} />
        <span style={{ width: 1, height: 34, background: C.rule }} />
        <span style={{ fontFamily: sans, fontSize: 22, color: C.muted }}>by</span>
        <div style={{ borderRadius: 10, overflow: "hidden", height: 72 }}><Logo name="netlayer" height={72} /></div>
      </div>
    </Fill>
  );
};
