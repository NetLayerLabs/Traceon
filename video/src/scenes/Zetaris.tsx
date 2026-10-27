import React from "react";
import { interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, expo, pop } from "../ui/motion";
import { LogoChip } from "../ui/Logo";
import { Trace } from "../ui/Trace";
import { Words } from "../ui/Words";
import { Fill, In, Kicker, Note, R, SIM, ease, useCue } from "./common";

/** The five silos of the reference company, as the app names them (src/lib/investigation.ts). */
const SILOS = [
  { name: "ERP", sub: "production lots" },
  { name: "Supplier BOM", sub: "cell batches" },
  { name: "Telemetry", sub: "firmware" },
  { name: "WMS", sub: "warehouses, shipments" },
  { name: "Warranty", sub: "Salesforce claims" },
];
/** The heat screen, exactly as the agent ran it (exhibit E-10 of the reference case). */
const Q = R.reference.sampleSql.find((q) => q.label === "H-HEAT screen")!;

export const Zetaris: React.FC = () => {
  const { f, rel } = useCue("zetaris");
  const tFive = rel("five"), tNever = rel("never"), tZ = rel("Zetaris"), tLayer = rel("layer"), tQuery = rel("query"), tRead = rel("read,"), tAgain = rel("again.");
  const W = 300, G = 34, X0 = 160, Y0 = 250;
  const apart = interpolate(f, [tNever, tNever + 12, tZ - 6, tZ + 10], [0, 1, 1, 0], { ...clamp, easing: expo });
  const layer = ease(f, tLayer - 8, 22);
  const typed = interpolate(f, [tQuery - 6, tQuery + 34], [0, 1], clamp);
  const sql = Q.sql;
  const rows = (Q.rows ?? []) as { grp: string; units: number; failures: number }[];

  return (
    <Fill tone="dark">
      <div style={{ position: "absolute", left: X0, top: 92 }}>
        <In at={0}><Kicker>Why Zetaris</Kicker></In>
        <div style={{ marginTop: 18, fontFamily: sans, fontWeight: 500, fontSize: 64, letterSpacing: "-0.04em", color: C.paper }}>
          <Words text="Five systems that never meet." at={tFive - 6} every={3} accent={{ "never": C.signalHi }} />
        </div>
      </div>
      {SILOS.map((s, i) => {
        const p = pop(f, tFive - 4 + i * 5);
        const jitter = apart * (i % 2 ? 14 : -14);
        const x = X0 + i * (W + G);
        return (
          <div key={s.name} style={{
            position: "absolute", left: x, top: Y0 + jitter, width: W, height: 110, borderRadius: 12, background: C.panel,
            boxShadow: `0 0 0 1px ${apart > 0.2 ? "rgba(228,87,46,0.45)" : "rgba(242,239,231,0.12)"}`, padding: "20px 22px",
            opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 26}px)`,
          }}>
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 28, color: C.paper }}>{s.name}</div>
            <div style={{ marginTop: 6, fontFamily: mono, fontSize: 15, letterSpacing: "0.08em", color: "rgba(242,239,231,0.55)" }}>{s.sub.toUpperCase()}</div>
          </div>
        );
      })}
      {/* one SQL layer under all five */}
      {SILOS.map((_, i) => {
        const x = X0 + i * (W + G) + W / 2;
        return <Trace key={i} d={`M${x},${Y0 + 112} L${x},${Y0 + 186}`} p={ease(f, tLayer - 4 + i * 3, 14)} color={C.zetaris} width={3} />;
      })}
      <div style={{
        position: "absolute", left: X0, top: Y0 + 186, width: 5 * W + 4 * G, height: 78, borderRadius: 12,
        background: `linear-gradient(90deg, ${C.zetaris}, #6b77f0)`, opacity: layer, transform: `scaleX(${0.6 + 0.4 * layer})`, transformOrigin: "50% 50%",
        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", boxShadow: `0 20px 60px rgba(70,84,232,${0.35 * layer})`,
      }}>
        <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 30, color: "#fff", letterSpacing: "-0.01em" }}>One SQL layer over all five</span>
        <span style={{ fontFamily: mono, fontSize: 16, letterSpacing: "0.1em", color: "rgba(255,255,255,0.85)" }}>FEDERATED QUERIES</span>
      </div>
      <div style={{ position: "absolute", left: X0 + 5 * W + 4 * G - 330, top: 96, opacity: ease(f, tZ - 6, 16), transform: `scale(${0.9 + 0.1 * ease(f, tZ - 6, 16)})`, transformOrigin: "100% 0" }}>
        <LogoChip name="zetaris" height={58} pad={16} />
      </div>

      {/* a real query, read and run again */}
      <div style={{ position: "absolute", left: X0, top: 630, width: 1080, opacity: ease(f, tQuery - 10, 14) }}>
        <div style={{ background: "#0c0b0a", borderRadius: 12, padding: "20px 26px", boxShadow: "0 0 0 1px rgba(242,239,231,0.12)" }}>
          <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: "0.12em", color: "rgba(242,239,231,0.5)" }}>EXHIBIT {Q.id} · {Q.label.toUpperCase()} · RUNS ON ZETARIS</div>
          <pre style={{ margin: "12px 0 0", fontFamily: mono, fontSize: 23, lineHeight: 1.45, color: C.paper, whiteSpace: "pre" }}>
            {sql.slice(0, Math.round(typed * sql.length))}
            <span style={{ opacity: typed < 1 && Math.floor(f / 8) % 2 ? 1 : 0, color: C.signalHi }}>▍</span>
          </pre>
        </div>
      </div>
      <div style={{ position: "absolute", left: X0 + 1110, top: 630, width: 500 }}>
        {rows.slice(0, 4).map((r, i) => (
          <div key={r.grp} style={{
            display: "flex", justifyContent: "space-between", gap: 14, fontFamily: mono, fontSize: 20, color: C.paper, padding: "10px 4px",
            borderBottom: "1px solid rgba(242,239,231,0.1)", opacity: ease(f, tQuery + 30 + i * 4, 10),
          }}>
            <span>{r.grp}</span><span style={{ color: "rgba(242,239,231,0.62)" }}>{r.units.toLocaleString("en-US")} units</span><span style={{ color: C.signalHi }}>{r.failures} failed</span>
          </div>
        ))}
        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", opacity: ease(f, tRead - 4, 12) }}>
          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.1em", color: "rgba(242,239,231,0.55)" }}>PROOF HASH</span>
          <span style={{ fontFamily: mono, fontSize: 18, color: C.paper }}>{Q.proofHash.slice(0, 16)}…</span>
          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.1em", color: C.okHi, opacity: ease(f, tAgain - 2, 10) }}>↻ RE-RUN · SAME HASH</span>
        </div>
      </div>
      <Note color="rgba(242,239,231,0.4)" size={13} style={{ position: "absolute", left: X0, top: 900 }}>{SIM}</Note>
    </Fill>
  );
};
