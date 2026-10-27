import React from "react";
import { C, mono, sans } from "../theme";
import { pop } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Trace } from "../ui/Trace";
import { Fill, Kicker, L, R, ease, useCue } from "./common";

/** Under the hood: every number opens its SQL and rows; every step is hashed; one click replays the chain. */
export const Proof: React.FC = () => {
  const { f, rel } = useCue("proof");
  const tLinks = rel("links"), tHashed = rel("hashed,"), tSigned = rel("signed"), tTime = rel("timestamped."), tReplays = rel("replays"), tRoot = rel("root.");
  const chain = (L.live?.chain ?? []).slice(0, 5);
  const root = L.live?.root ?? R.reference.offlineLedgerRoot;
  const X = 1250;
  return (
    <Fill tone="dark">
      <Browser name="proof" url="traceon.netlayerlabs.com/app" width={1080} left={90} top={170}
        cams={[{ f: 0, rect: "graph", z: 1.3 }, { f: tLinks + 10, rect: "exhibit", z: 1.5 }, { f: tReplays - 6, rect: "replay", z: 1.5 }]} />
      <div style={{ position: "absolute", left: X, top: 120 }}><Kicker color="rgba(242,239,231,0.6)">Under the hood</Kicker></div>
      {(chain.length ? chain : ["", "", "", "", ""]).map((h, i) => {
        const p = pop(f, tHashed - 6 + i * 5);
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: X, top: 180 + i * 84, width: 560, height: 62, borderRadius: 10, background: C.panel, boxShadow: "0 0 0 1px rgba(242,239,231,0.1)", display: "flex", alignItems: "center", gap: 16, padding: "0 18px", opacity: Math.min(1, p * 1.3), transform: `translateX(${(1 - p) * 24}px)` }}>
              <span style={{ fontFamily: mono, fontSize: 14, color: "rgba(242,239,231,0.5)" }}>E-{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontFamily: mono, fontSize: 19, color: C.paper }}>{h ? `${h.slice(0, 28)}…` : "sha-256 …"}</span>
            </div>
            {i ? <Trace d={`M${X + 30},${180 + i * 84 - 22} L${X + 30},${180 + i * 84}`} p={p} color={C.signalHi} width={2} /> : null}
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: X, top: 612, display: "flex", gap: 12, opacity: ease(f, tSigned - 4, 12) }}>
        {["Ed25519 signature", "OpenTimestamps"].map((t, i) => (
          <span key={t} style={{ fontFamily: mono, fontSize: 16, letterSpacing: "0.06em", color: C.paper, padding: "8px 14px", borderRadius: 999, boxShadow: "0 0 0 1px rgba(242,239,231,0.25)", opacity: ease(f, (i ? tTime : tSigned) - 4, 10) }}>{t}</span>
        ))}
      </div>
      <div style={{ position: "absolute", left: X, top: 690, width: 570, opacity: ease(f, tReplays - 2, 14) }}>
        <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: "rgba(242,239,231,0.55)" }}>REPLAY · ROOT</div>
        <div style={{ marginTop: 8, fontFamily: mono, fontSize: 22, color: C.paper }}>{root.slice(0, 32)}…</div>
        <div style={{ marginTop: 10, fontFamily: sans, fontWeight: 600, fontSize: 40, color: C.okHi, opacity: ease(f, tRoot - 4, 10) }}>✓ same root</div>
      </div>
    </Fill>
  );
};
