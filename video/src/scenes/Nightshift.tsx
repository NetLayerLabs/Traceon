import React from "react";
import { C, mono, sans } from "../theme";
import { pop } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Logo, LogoChip } from "../ui/Logo";
import { Trace } from "../ui/Trace";
import { Fill, Kicker, L, Note, ease, useCue } from "./common";

/** One real run on the Mac with Meterless Nightshift as the AI provider, routed to NVIDIA Nemotron. */
export const Nightshift: React.FC = () => {
  const { f, rel } = useCue("nightshift");
  const tEvery = rel("Every"), tNs = rel("Nightshift,"), tRouted = rel("routed"), tLight = rel("Lightning"), tUltra = rel("Ultra"), tThen = rel("Then"), tWrote = rel("wrote.");
  const ns = L.nightshift;
  const X = 1250;
  const node = (at: number, children: React.ReactNode, top: number, accent: string) => {
    const p = pop(f, at);
    return (
      <div style={{ position: "absolute", left: X, top, width: 570, background: C.panel, borderRadius: 12, padding: "14px 18px", boxShadow: `0 0 0 1px rgba(242,239,231,0.1)`, borderLeft: `4px solid ${accent}`, opacity: Math.min(1, p * 1.3), transform: `translateY(${(1 - p) * 16}px)` }}>{children}</div>
    );
  };
  return (
    <Fill tone="dark">
      <Browser name="nightshift" url={ns?.url ?? "localhost:3000/app · on this Mac"} width={1080} left={90} top={170}
        cams={[{ f: 0, z: 1 }, { f: tLight - 6, rect: "trace", z: 1.5 }, { f: tThen, rect: "explanation", z: 1.5 }]} />
      <div style={{ position: "absolute", left: X, top: 104 }}><Kicker color="rgba(242,239,231,0.6)">One real request, on this Mac</Kicker></div>
      {node(tEvery, <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 26, color: C.paper }}>Traceon <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 400, color: "rgba(242,239,231,0.55)", marginLeft: 10 }}>EVERY MODEL CALL</span></div>, 150, C.signal)}
      <Trace d={`M${X + 40},214 L${X + 40},252`} p={ease(f, tNs - 8, 12)} color={C.paper} width={2} />
      {node(tNs - 4, <>
        <Logo name="meterlessLight" height={26} />
        <div style={{ marginTop: 8, fontFamily: mono, fontSize: 15, color: "rgba(242,239,231,0.62)" }}>Nightshift · 127.0.0.1:8088/v1 · meterless-app: traceon</div>
      </>, 254, C.paper)}
      <Trace d={`M${X + 40},356 L${X + 40},394`} p={ease(f, tRouted - 6, 12)} color={C.nvidia} width={2} />
      {node(tRouted - 2, <>
        <LogoChip name="nvidia" height={22} pad={8} />
        <div style={{ marginTop: 12, fontFamily: mono, fontSize: 17, lineHeight: 1.6, color: C.paper }}>
          <div style={{ opacity: ease(f, tLight - 4, 10) }}><span style={{ color: C.nvidia }}>■</span> nemotron-3.5-lightning · plan, red team</div>
          <div style={{ opacity: ease(f, tUltra - 4, 10) }}><span style={{ color: C.nvidia }}>■</span> nemotron-3-ultra · explanation</div>
        </div>
      </>, 396, C.nvidia)}
      <div style={{ position: "absolute", left: X, top: 600, width: 570, opacity: ease(f, tThen - 4, 14) }}>
        <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: "rgba(242,239,231,0.55)" }}>EVERY FIGURE THE MODEL WROTE, CHECKED</div>
        <div style={{ marginTop: 10, fontFamily: sans, fontWeight: 600, fontSize: 72, letterSpacing: "-0.04em", color: C.okHi }}>
          {ns ? `${ns.guard.verified} / ${ns.guard.checked}` : "—"}
          <span style={{ fontFamily: sans, fontWeight: 400, fontSize: 26, color: "rgba(242,239,231,0.75)", marginLeft: 14 }}>verified against the evidence</span>
        </div>
      </div>
      {ns ? (
        <Note color="rgba(242,239,231,0.45)" size={13} style={{ position: "absolute", left: X, top: 720, width: 570, lineHeight: 1.6, opacity: ease(f, tWrote - 10, 12) }}>
          RECORDED {ns.at} · {ns.explanationVia.toUpperCase()}
        </Note>
      ) : null}
    </Fill>
  );
};
