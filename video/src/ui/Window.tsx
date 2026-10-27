import React from "react";
import { Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clip, rectOf, type Cam, type Rect } from "./Footage";
import { clamp, soft } from "./motion";

/**
 * A recorded macOS window (the clip already carries its own title bar), played with a camera
 * that eases between keyframes. `page` is the window's size in points (the capture is 2x).
 */
export const Window: React.FC<{
  name: string; width: number; left: number; top: number; page: { w: number; h: number };
  startFrom?: number; cams?: Cam[]; enter?: number; exit?: number; style?: React.CSSProperties; radius?: number;
}> = ({ name, width, left, top, page, startFrom = 0, cams = [], enter = 0, exit, style, radius = 14 }) => {
  const f = useCurrentFrame();
  const c = clip(name);
  const k = width / page.w;
  const vh = page.h * k;
  const pts = cams.map((cm) => {
    const r = typeof cm.rect === "string" ? rectOf(name, cm.rect) : (cm.rect as Rect | undefined);
    return { f: cm.f, z: cm.z ?? (r ? 1.5 : 1), cx: (r ? r.x + r.w / 2 : page.w / 2) + (cm.dx ?? 0), cy: (r ? r.y + r.h / 2 : page.h / 2) + (cm.dy ?? 0) };
  });
  let cam = pts[0] ?? { z: 1, cx: page.w / 2, cy: page.h / 2 };
  for (let i = 1; i < pts.length; i++) {
    if (f >= pts[i - 1].f) {
      const t = interpolate(f, [pts[i - 1].f, pts[i].f], [0, 1], { ...clamp, easing: soft });
      const a = pts[i - 1], b = pts[i];
      cam = { f, z: a.z + (b.z - a.z) * t, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
    }
  }
  const s = cam.z;
  const tx = Math.min(0, Math.max(width - page.w * k * s, width / 2 - cam.cx * k * s));
  const ty = Math.min(0, Math.max(vh - page.h * k * s, vh / 2 - cam.cy * k * s));
  const inP = interpolate(f, [enter, enter + 20], [0, 1], { ...clamp, easing: soft });
  const outP = exit != null ? interpolate(f, [exit, exit + 14], [0, 1], { ...clamp, easing: soft }) : 0;
  const last = c ? c.durationFrames - 2 : 0;
  const video = c ? <OffthreadVideo src={staticFile(c.file)} startFrom={startFrom} muted style={{ width: page.w, height: page.h }} /> : null;
  const player = f + startFrom >= last ? <Freeze frame={last - startFrom}>{video}</Freeze> : <Sequence layout="none">{video}</Sequence>;
  return (
    <div style={{
      position: "absolute", left, top, width, height: vh, borderRadius: radius, overflow: "hidden", background: "#0b0c12",
      boxShadow: "0 0 0 1px rgba(242,239,231,0.12), 0 50px 110px rgba(0,0,0,0.6)",
      opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * 40 - outP * 24}px) scale(${0.97 + 0.03 * inP})`, ...style,
    }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: page.w, height: page.h, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${k * s})` }}>
        {player}
      </div>
    </div>
  );
};
