import React from "react";
import { C, mono, sans } from "../theme";
import { pop } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Count } from "../ui/Count";
import { Logo } from "../ui/Logo";
import { Words } from "../ui/Words";
import { Fill, Kicker, Note, R, SIM, ease, useCue } from "./common";

/** Meterless H-MEM at work: the live intake, and 131 weak signals pulled into one incident across six cities. */
export const Converge: React.FC = () => {
  const { f, rel } = useCue("converge");
  const tMeter = rel("Meterless"), tPulls = rel("pulls"), tInc = rel("incident:"), tSix = rel("six");
  const sig = R.reference.signals;
  const cities = Object.entries(sig.cities).sort((a, b) => b[1] - a[1]);
  const max = cities[0][1];
  return (
    <Fill tone="dark">
      <Browser name="intake" url="traceon.netlayerlabs.com/app" width={1080} left={100} top={170} enter={0}
        cams={[{ f: 0, z: 1 }, { f: tPulls, rect: "convergence", z: 1.6 }, { f: tSix + 30, rect: "convergence", z: 1.7 }]} />
      <div style={{ position: "absolute", left: 1250, top: 150, width: 580 }}>
        <div style={{ opacity: ease(f, tMeter - 6, 14) }}><Logo name="meterlessLight" height={30} /></div>
        <Kicker style={{ marginTop: 16 }} color="rgba(242,239,231,0.6)">H-MEM · signal memory</Kicker>
        <div style={{ marginTop: 34, display: "flex", alignItems: "baseline", gap: 18 }}>
          <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 132, letterSpacing: "-0.05em", lineHeight: 1, color: C.paper }}><Count to={sig.matched} at={tPulls} dur={34} /></span>
          <span style={{ fontFamily: sans, fontSize: 30, color: "rgba(242,239,231,0.7)" }}>weak signals</span>
        </div>
        <div style={{ marginTop: 8, fontFamily: sans, fontWeight: 500, fontSize: 46, letterSpacing: "-0.03em", color: C.paper }}>
          <Words text="One incident." at={tInc - 2} every={3} accent={{ "incident.": C.signalHi }} />
        </div>
        <div style={{ marginTop: 10, fontFamily: mono, fontSize: 16, color: "rgba(242,239,231,0.55)", opacity: ease(f, tInc + 6, 12) }}>overheating at the connector · {sig.firstSeen} → {sig.lastSeen}</div>
        <div style={{ marginTop: 34 }}>
          {cities.map(([city, n], i) => {
            const p = pop(f, tSix - 8 + i * 3);
            return (
              <div key={city} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, opacity: Math.min(1, p * 1.3) }}>
                <span style={{ width: 170, fontFamily: sans, fontSize: 22, color: C.paper }}>{city}</span>
                <span style={{ height: 14, width: (n / max) * 300 * p, background: C.signalHi }} />
                <span style={{ fontFamily: mono, fontSize: 18, color: "rgba(242,239,231,0.7)" }}>{n}</span>
              </div>
            );
          })}
        </div>
        <Note color="rgba(242,239,231,0.4)" size={13} style={{ marginTop: 20 }}>{SIM}</Note>
      </div>
    </Fill>
  );
};
