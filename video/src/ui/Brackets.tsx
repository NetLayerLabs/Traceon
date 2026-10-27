import React from "react";
import { interpolateColors } from "remotion";
import { C } from "../theme";

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The film's motif, taken from Traceon's own mark: four corner brackets that hunt and lock.
 * `lock` (0..1) closes them from loose and wide onto the box; `release` (0..1) lets go, the
 * corners drifting apart and fading to ochre (a confounder let off); `square` (0..1) pops the
 * solid red centre square of the mark (the cause, locked).
 */
export const Brackets: React.FC<{
  box: Box; lock: number; release?: number; square?: number; color?: string; releaseColor?: string;
  stroke?: number; arm?: number; gap?: number; squareSize?: number; opacity?: number;
}> = ({ box, lock, release = 0, square = 0, color = C.signal, releaseColor = C.ochre, stroke = 4, arm, gap = 46, squareSize, opacity = 1 }) => {
  const a = arm ?? Math.max(16, Math.min(box.w, box.h) * 0.2);
  const off = (1 - lock) * gap + release * gap * 1.4;
  const op = Math.min(1, lock * 2.2) * (1 - release) * opacity;
  const col = release > 0 ? interpolateColors(release, [0, 1], [color, releaseColor]) : color;
  const x0 = box.x - off, y0 = box.y - off, x1 = box.x + box.w + off, y1 = box.y + box.h + off;
  const corners = [
    `M${x0},${y0 + a} L${x0},${y0} L${x0 + a},${y0}`,
    `M${x1 - a},${y0} L${x1},${y0} L${x1},${y0 + a}`,
    `M${x1},${y1 - a} L${x1},${y1} L${x1 - a},${y1}`,
    `M${x0 + a},${y1} L${x0},${y1} L${x0},${y1 - a}`,
  ];
  const s = squareSize ?? Math.min(box.w, box.h) * 0.3;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, overflow: "visible", pointerEvents: "none" }} width={1920} height={1080}>
      <g opacity={op}>
        {corners.map((d, i) => <path key={i} d={d} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="square" />)}
      </g>
      {square > 0 ? (
        <rect x={cx - (s * square) / 2} y={cy - (s * square) / 2} width={s * square} height={s * square} fill={C.signal} opacity={Math.min(1, square * 1.5) * opacity} />
      ) : null}
    </svg>
  );
};

/** The Traceon mark redrawn as an animatable SVG (corner brackets and the red square), centred on (cx, cy). */
export const Mark: React.FC<{ cx: number; cy: number; size: number; lock: number; square: number; color?: string }> = ({ cx, cy, size, lock, square, color = C.ink }) => (
  <Brackets box={{ x: cx - size / 2, y: cy - size / 2, w: size, h: size }} lock={lock} square={square} color={color} stroke={size * 0.07} arm={size * 0.3} gap={size * 0.9} squareSize={size * 0.42} />
);
