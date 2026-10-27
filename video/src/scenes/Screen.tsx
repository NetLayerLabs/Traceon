import React from "react";
import { C, mono, sans } from "../theme";
import { pop } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Count } from "../ui/Count";
import { LogoChip } from "../ui/Logo";
import { Words } from "../ui/Words";
import { Fill, Kicker, L, R, ease, useCue } from "./common";

/** The live run on traceon.netlayerlabs.com: Nemotron plans, each suspect becomes a query on Zetaris. */
export const Screen: React.FC = () => {
  const { f, rel } = useCue("screen");
  const tNem = rel("Nemotron"), tSeven = rel("seven"), tZ = rel("Zetaris:"), t46 = rel("forty-six"), tHash = rel("hashed."), tModel = rel("model");
  const live = L.live;
  const queries = live?.onZetaris ?? R.reference.sqlQueries;
  return (
    <Fill tone="light">
      <Browser name="screen" url="traceon.netlayerlabs.com/app" width={1120} left={90} top={150} light
        cams={[{ f: 0, z: 1 }, { f: tZ, rect: "trace", z: 1.45 }, { f: tModel, rect: "trace", z: 1.5 }]} />
      <div style={{ position: "absolute", left: 1270, top: 150, width: 560 }}>
        <div style={{ opacity: ease(f, tNem - 6, 14) }}><LogoChip name="nvidia" height={34} pad={14} /></div>
        <Kicker style={{ marginTop: 18 }} color="rgba(26,23,20,0.55)">Nemotron plans the suspects</Kicker>
        <div style={{ marginTop: 14 }}>
          {R.reference.hypotheses.map((h, i) => (
            <div key={h.id} style={{ fontFamily: sans, fontSize: 22, lineHeight: 1.5, color: C.ink, opacity: Math.min(1, pop(f, tSeven - 6 + i * 3) * 1.3) }}>
              <span style={{ fontFamily: mono, fontSize: 15, color: C.muted, marginRight: 12 }}>{h.id}</span>{h.title}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 30, display: "flex", alignItems: "center", gap: 16, opacity: ease(f, tZ - 6, 14) }}>
          <LogoChip name="zetaris" height={40} pad={12} style={{ boxShadow: "0 0 0 1px rgba(26,23,20,0.1)" }} />
          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.1em", color: live?.parity ? C.ok : C.muted }}>{live ? (live.parity ? "PARITY ✓" : "PARITY ✗") : ""}</span>
        </div>
        <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 104, letterSpacing: "-0.05em", lineHeight: 1, color: C.zetaris }}><Count to={queries} at={t46 - 4} dur={26} /></span>
          <span style={{ fontFamily: sans, fontSize: 28, color: C.ink }}>queries on Zetaris{live ? ` · ${Math.round(live.seconds)} s` : ""}</span>
        </div>
        <div style={{ marginTop: 10, fontFamily: mono, fontSize: 17, color: C.muted, opacity: ease(f, tHash - 4, 12) }}>every result hashed into the proof</div>
        <div style={{ marginTop: 34, fontFamily: sans, fontWeight: 500, fontSize: 44, letterSpacing: "-0.03em", lineHeight: 1.12, color: C.ink }}>
          <Words text="The model never computes a statistic. The code does." at={tModel - 2} every={3} accent={{ "code": C.signal }} />
        </div>
      </div>
    </Fill>
  );
};
