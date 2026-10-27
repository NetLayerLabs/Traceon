import React from "react";
import { interpolate } from "remotion";
import { C, sans } from "../theme";
import { clamp, expo, pop } from "../ui/motion";
import { Brackets } from "../ui/Brackets";
import { Logo } from "../ui/Logo";
import { Words } from "../ui/Words";
import { Fill, ease, useCue } from "./common";

/** The turn: four brackets fly in from the frame's corners and lock into Traceon's mark, then the real logo. */
export const Turn: React.FC = () => {
  const { f, rel } = useCue("turn");
  const tName = rel("Traceon."), tAn = rel("An");
  // Logo at height 150: the PNG is 882x160, its mark sits in the first ~150 px.
  const H = 150, W = (H * 882) / 160, LX = 960 - W / 2, LY = 330;
  const markBox = { x: LX + 4, y: LY + 6, w: H * 0.83, h: H * 0.83 };
  const fly = interpolate(f, [tName - 26, tName], [0, 1], { ...clamp, easing: expo });
  // The brackets travel from the frame edges to the mark.
  const from = { x: 60, y: 60, w: 1800, h: 960 };
  const box = { x: from.x + (markBox.x - from.x) * fly, y: from.y + (markBox.y - from.y) * fly, w: from.w + (markBox.w - from.w) * fly, h: from.h + (markBox.h - from.h) * fly };
  const sq = pop(f, tName - 2);
  const logo = ease(f, tName + 4, 14);
  const ring = interpolate(f, [tName - 2, tName + 34], [0, 1], clamp);
  return (
    <Fill tone="light">
      <div style={{ position: "absolute", left: markBox.x + markBox.w / 2 - 420, top: markBox.y + markBox.h / 2 - 420, width: 840, height: 840, borderRadius: "50%", border: `2px solid rgba(194,61,23,${0.5 * (1 - ring)})`, transform: `scale(${0.15 + ring * 1.3})`, opacity: ring > 0 ? 1 : 0 }} />
      {logo < 1 ? <Brackets box={box} lock={Math.min(1, 0.2 + fly)} square={sq} color={C.ink} stroke={8} arm={36 + (1 - fly) * 70} gap={0} squareSize={markBox.w * 0.42} opacity={1 - logo} /> : null}
      <div style={{ position: "absolute", left: LX, top: LY, opacity: logo, transform: `translateX(${(1 - logo) * -12}px)` }}>
        <Logo name="traceon" height={H} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 590, textAlign: "center", fontFamily: sans, fontWeight: 500, fontSize: 62, letterSpacing: "-0.035em", color: C.ink }}>
        <Words text="An AI agent that proves the cause," at={tAn} every={3} accent={{ "cause,": C.signal }} />
        <div style={{ marginTop: 6 }}><Words text="before you recall." at={tAn + 24} every={3} /></div>
      </div>
    </Fill>
  );
};
