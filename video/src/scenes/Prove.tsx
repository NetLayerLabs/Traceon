import React from "react";
import { C, mono, sans, serif } from "../theme";
import { pop } from "../ui/motion";
import { Browser, syncTo } from "../ui/Footage";
import { Words } from "../ui/Words";
import { Fill, Kicker, L, R, ease, useCue } from "./common";

/** The red team and the evidence gate: objections answered by tests; seven criteria, or no action. */
export const Prove: React.FC = () => {
  const { f, rel } = useCue("prove");
  const tTries = rel("tries"), tObj = rel("objections,"), tAns = rel("answered"), tSeven = rel("Seven"), tBlocks = rel("blocks");
  const objections = (L.live?.objections ?? R.reference.redteam).slice(0, 2);
  const criteria = R.reference.gate.criteria;
  return (
    <Fill tone="light">
      <Browser name="run_live" url="traceon.netlayerlabs.com/app" width={1060} left={90} top={150} light
        startFrom={syncTo("run_live", "run_live.gate", tSeven - 12)}
        cams={[{ f: 0, rect: "redteam", z: 1.6 }, { f: tSeven - 14, rect: "gate", z: 1.6 }]} />
      <div style={{ position: "absolute", left: 1210, top: 140, width: 640 }}>
        <Kicker color="rgba(26,23,20,0.55)">It tries to prove itself wrong</Kicker>
        {objections.map((o, i) => {
          const p = pop(f, tObj - 4 + i * 10);
          return (
            <div key={i} style={{ marginTop: 18, background: C.sheet, borderRadius: 12, padding: "16px 20px", boxShadow: "0 0 0 1px rgba(26,23,20,0.1)", opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 18}px)` }}>
              <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 25, lineHeight: 1.25, color: C.ink }}>“{o.objection}”</div>
              {(() => {
                const open = /open question/i.test(o.result);
                return (
                  <div style={{ marginTop: 10, fontFamily: mono, fontSize: 15, lineHeight: 1.45, color: open ? C.ochre : C.ok, opacity: ease(f, tAns + i * 6, 12) }}>
                    <span style={{ fontWeight: 600, letterSpacing: "0.08em" }}>{open ? "OPEN QUESTION" : "ANSWERED BY A TEST"}</span> · {o.result.length > 110 ? o.result.slice(0, 108) + "…" : o.result}
                  </div>
                );
              })()}
            </div>
          );
        })}
        <div style={{ marginTop: 26, fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: C.muted, opacity: ease(f, tSeven - 6, 10) }}>EVIDENCE GATE · ALL SEVEN MUST PASS</div>
        <div style={{ marginTop: 10 }}>
          {criteria.map((c, i) => {
            const on = f >= tSeven + 2 + i * 5;
            return (
              <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: sans, fontSize: 20, lineHeight: 1.55, color: C.ink, opacity: ease(f, tSeven - 4 + i * 2, 10) }}>
                <span style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", background: on ? C.ok : "transparent", boxShadow: on ? undefined : "inset 0 0 0 2px rgba(26,23,20,0.25)", color: "#fff", fontSize: 15, fontWeight: 700 }}>{on ? "✓" : ""}</span>
                {c.label}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 22, fontFamily: sans, fontWeight: 500, fontSize: 34, letterSpacing: "-0.02em", color: C.ink }}>
          <Words text="Or Traceon blocks its own action." at={tBlocks - 8} every={3} accent={{ "blocks": C.signal }} />
        </div>
      </div>
    </Fill>
  );
};
