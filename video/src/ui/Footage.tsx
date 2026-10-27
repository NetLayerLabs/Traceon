import React from "react";
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import footage from "../footage.json";
import { C, mono, sans } from "../theme";
import { clamp, soft } from "./motion";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Clip { file: string; width: number; height: number; durationFrames: number; marks?: Record<string, number>; rects?: Record<string, Rect | null> }
const LIB = footage as unknown as Record<string, Clip>;
export const clip = (name: string): Clip | undefined => LIB[name];
export const markOf = (name: string, m: string) => clip(name)?.marks?.[m] ?? 0;
/** startFrom so that clip mark `m` lands on local frame `at` of the parent sequence. */
export const syncTo = (name: string, m: string, at: number) => Math.max(0, markOf(name, m) - at);
export const rectOf = (name: string, r: string): Rect | undefined => clip(name)?.rects?.[r] ?? undefined;

/** The page the footage was recorded at, in CSS pixels. */
export const PAGE = { w: 1600, h: 900 };

/** A camera keyframe: at local frame `f`, centre on `rect` (page CSS px) at `z` times the fit. */
export interface Cam { f: number; rect?: Rect | string; z?: number; dx?: number; dy?: number }

function camAt(f: number, cams: Cam[], name: string) {
  const pts = cams.map((c) => {
    const r = typeof c.rect === "string" ? rectOf(name, c.rect) : c.rect;
    return { f: c.f, z: c.z ?? (r ? 1.5 : 1), cx: (r ? r.x + r.w / 2 : PAGE.w / 2) + (c.dx ?? 0), cy: (r ? r.y + r.h / 2 : PAGE.h / 2) + (c.dy ?? 0) };
  });
  if (!pts.length) return { z: 1, cx: PAGE.w / 2, cy: PAGE.h / 2 };
  if (f <= pts[0].f) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (f <= pts[i].f) {
      const a = pts[i - 1], b = pts[i];
      const t = interpolate(f, [a.f, b.f], [0, 1], { ...clamp, easing: soft });
      return { z: a.z + (b.z - a.z) * t, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
    }
  }
  return pts[pts.length - 1];
}

/**
 * A browser window playing a recorded clip of the live app, with a camera that eases between
 * keyframes. The clip holds its last frame if the scene outlasts it.
 */
export const Browser: React.FC<{
  name: string; url: string; width: number; left: number; top: number;
  startFrom?: number; cams?: Cam[]; enter?: number; exit?: number; tilt?: number; style?: React.CSSProperties; hold?: number; light?: boolean;
  /** Clip frame to freeze on. */ stopAt?: number;
}> = ({ name, url, width, left, top, startFrom = 0, cams = [], enter = 0, exit, tilt = 0, style, hold = 0, light, stopAt }) => {
  const f = useCurrentFrame();
  const c = clip(name);
  const bar = 42;
  const PH = c ? Math.round((PAGE.w * c.height) / c.width) : PAGE.h;
  const vh = (width * PH) / PAGE.w;
  const k = width / PAGE.w;
  const cam = camAt(f, cams, name);
  const s = cam.z;
  const tx = Math.min(0, Math.max(width - PAGE.w * k * s, width / 2 - cam.cx * k * s));
  const ty = Math.min(0, Math.max(vh - PH * k * s, vh / 2 - cam.cy * k * s));
  const inP = interpolate(f, [enter, enter + 20], [0, 1], { ...clamp, easing: soft });
  const outP = exit != null ? interpolate(f, [exit, exit + 14], [0, 1], { ...clamp, easing: soft }) : 0;
  const last = Math.min(c ? c.durationFrames - 2 : 0, stopAt ?? Infinity);
  const pos = Math.max(0, f - hold) + startFrom;
  const video = c ? <OffthreadVideo src={staticFile(c.file)} startFrom={startFrom} muted style={{ width: PAGE.w, height: PH }} /> : null;
  const player = f < hold ? <Freeze frame={0}>{video}</Freeze> : pos >= last ? <Freeze frame={last - startFrom}>{video}</Freeze> : <Sequence from={hold} layout="none">{video}</Sequence>;
  return (
    <div style={{
      position: "absolute", left, top, width, height: vh + bar, borderRadius: 16, overflow: "hidden", background: C.sheet,
      boxShadow: light ? "0 0 0 1px rgba(26,23,20,0.14), 0 40px 90px rgba(60,40,20,0.22)" : "0 0 0 1px rgba(242,239,231,0.12), 0 50px 110px rgba(0,0,0,0.6)",
      opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * 50 - outP * 30}px) scale(${0.97 + 0.03 * inP}) perspective(2400px) rotateX(${tilt * (1 - inP)}deg)`, ...style,
    }}>
      <div style={{ height: bar, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: light ? "#e9e4d8" : "#1c1916", borderBottom: light ? "1px solid rgba(26,23,20,0.1)" : "1px solid rgba(242,239,231,0.08)" }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 11, height: 11, borderRadius: 6, background: light ? "rgba(26,23,20,0.16)" : "rgba(242,239,231,0.18)" }} />)}
        <div style={{ marginLeft: 16, flex: 1, height: 26, borderRadius: 8, background: light ? "rgba(255,255,255,0.7)" : "rgba(242,239,231,0.06)", display: "flex", alignItems: "center", padding: "0 14px", fontFamily: mono, fontSize: 14, color: light ? "rgba(26,23,20,0.62)" : "rgba(242,239,231,0.62)", letterSpacing: "0.02em" }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: C.signal, marginRight: 10 }} />{url}
        </div>
      </div>
      <div style={{ position: "relative", width, height: vh, overflow: "hidden", background: C.paper }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: PAGE.w, height: PH, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${k * s})` }}>
          {c ? player : (
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: sans, color: C.muted, fontSize: 28, background: C.sheet }}>footage “{name}” pending</AbsoluteFill>
          )}
        </div>
      </div>
    </div>
  );
};
