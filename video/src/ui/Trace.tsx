import React from "react";

/** A path that draws itself: `p` (0..1) of its length is stroked. Used for the trace line between evidence. */
export const Trace: React.FC<{ d: string; p: number; color: string; width?: number; dashed?: boolean; opacity?: number }> = ({ d, p, color, width = 3, dashed, opacity = 1 }) => (
  <svg style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, overflow: "visible", pointerEvents: "none" }} width={1920} height={1080}>
    <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" opacity={opacity}
      strokeDasharray={dashed ? undefined : "1 1"} strokeDashoffset={dashed ? undefined : 1 - p}
      style={dashed ? { strokeDasharray: "0.006 0.012", clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` } : undefined} />
  </svg>
);
