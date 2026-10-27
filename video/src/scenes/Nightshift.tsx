import React from "react";
import { AbsoluteFill, Sequence, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp } from "../ui/motion";
import { Browser, markOf } from "../ui/Footage";
import { Window } from "../ui/Window";
import { Kicker, L, Note, ease, useCue, Fill } from "./common";

/** The Nightshift app's window, in points (captured at 2x). */
const NS = { w: 1320, h: 860 };
const NS_RECTS = {
  banner: { x: 20, y: 64, w: 640, h: 50 },
  status: { x: 0, y: 826, w: 470, h: 34 },
  nvidia: { x: 38, y: 300, w: 612, h: 230 },
};

/**
 * One real run on this Mac. First both sides at once: Traceon running, and Nightshift's own
 * window counting the requests it serves. Then Traceon's cards, which name the model behind
 * each step, and the check on every figure the model wrote.
 */
export const Nightshift: React.FC = () => {
  const { f, rel } = useCue("nightshift");
  const tNs = rel("Nightshift,"), tRouted = rel("routed"), tLight = rel("Lightning"), tUltra = rel("Ultra"), tThen = rel("Then"), tFigure = rel("figure");
  const ns = L.nightshift;
  const cut = tLight - 14;
  // Beat 1: the run as it happens (the counter ticks while Nemotron plans and red-teams).
  const runFrom = Math.max(0, markOf("nightshift_local", "nightshift_local.run") + 120);
  const appOffset = markOf("nightshift_app", "nightshift_local.run") - markOf("nightshift_local", "nightshift_local.run");
  // Beat 2: the finished case, scrolled to the explanation and red-team cards.
  const cardsFrom = Math.max(0, markOf("nightshift_local", "nightshift_local.explain") - 20);
  const b2 = interpolate(f, [cut, cut + 14], [0, 1], clamp);
  return (
    <Fill tone="dark">
      <div style={{ position: "absolute", left: 90, top: 92, opacity: 1 - b2 }}>
        <Kicker color="rgba(242,239,231,0.6)">One real run on this Mac · Traceon and Meterless Nightshift, side by side</Kicker>
      </div>
      <Sequence durationInFrames={cut + 14} layout="none">
        <AbsoluteFill style={{ opacity: 1 - b2 }}>
          <Browser name="nightshift_local" url="localhost · this Mac · Traceon" width={900} left={90} top={150} startFrom={runFrom}
            cams={[{ f: 0, z: 1 }]} />
          <Window name="nightshift_app" page={NS} width={830} left={1010} top={150} startFrom={runFrom + appOffset}
            cams={[{ f: 0, z: 1 }, { f: tNs - 6, rect: NS_RECTS.status, z: 2.6, dx: 60 }, { f: tRouted + 4, rect: NS_RECTS.status, z: 2.6, dx: 60 }, { f: tRouted + 26, rect: NS_RECTS.nvidia, z: 1.7 }]} />
          <div style={{ position: "absolute", left: 1010, top: 718, width: 830, fontFamily: mono, fontSize: 16, lineHeight: 1.6, color: "rgba(242,239,231,0.62)", opacity: ease(f, tNs, 12) }}>
            NIGHTSHIFT’S OWN COUNTER: EVERY REQUEST IT SERVES · NVIDIA KEY STORED ON THIS MAC
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={cut} layout="none">
        <AbsoluteFill style={{ opacity: b2 }}>
          <Browser name="nightshift_local" url="localhost · this Mac · Traceon" width={1300} left={90} top={130} startFrom={cardsFrom} stopAt={cardsFrom + 110}
            cams={[{ f: 0, rect: "redteam", z: 1.9, dy: -60 }, { f: tUltra - cut - 6, rect: "explain", z: 1.9, dy: -60 }, { f: tThen - cut, rect: "explain", z: 1.9, dy: -60 }, { f: tFigure - cut, rect: "explain", z: 2.3, dy: -70, dx: -40 }]} />
          <div style={{ position: "absolute", left: 1440, top: 150, width: 400 }}>
            <Kicker color="rgba(242,239,231,0.6)">Who answered</Kicker>
            <div style={{ marginTop: 16, fontFamily: mono, fontSize: 17, lineHeight: 1.65, color: C.paper, overflowWrap: "anywhere" }}>
              <div style={{ opacity: ease(f, tLight - 4, 10) }}><span style={{ color: C.nvidia }}>■</span> plan, red team<br /><span style={{ color: "rgba(242,239,231,0.7)" }}>{ns?.planVia ?? ""}</span></div>
              <div style={{ marginTop: 14, opacity: ease(f, tUltra - 4, 10) }}><span style={{ color: C.nvidia }}>■</span> explanation<br /><span style={{ color: "rgba(242,239,231,0.7)" }}>{ns?.explanationVia ?? ""}</span></div>
            </div>
            <div style={{ marginTop: 30, fontFamily: mono, fontSize: 15, letterSpacing: "0.12em", color: "rgba(242,239,231,0.55)", opacity: ease(f, tThen - 4, 12) }}>FIGURES CHECKED</div>
            <div style={{ marginTop: 6, fontFamily: sans, fontWeight: 600, fontSize: 76, letterSpacing: "-0.04em", color: C.okHi, opacity: ease(f, tThen, 12) }}>
              {ns?.guard ? `${ns.guard.verified}/${ns.guard.checked}` : ""}
            </div>
            {ns ? <Note color="rgba(242,239,231,0.45)" size={13} style={{ marginTop: 18, lineHeight: 1.6, opacity: ease(f, tFigure, 12) }}>RECORDED {ns.at} · {ns.queries} QUERIES · {ns.seconds} S</Note> : null}
          </div>
        </AbsoluteFill>
      </Sequence>
    </Fill>
  );
};
