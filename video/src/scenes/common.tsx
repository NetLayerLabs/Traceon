import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { scene, wordAt } from "../timing";
import { C, TONE, mono, sans, type Tone } from "../theme";
import { clamp, expo, pop } from "../ui/motion";
import real from "../../data/real.json";
import live from "../../data/live.json";

/** Every figure in the film comes from data/real.json (the app's own engine, NHTSA, Backblaze). */
export const R = real as unknown as typeof real;
/** Figures from the recorded runs: the live site on Zetaris, and the Mac run through Nightshift (null until captured). */
export interface LiveRun { url: string; at: string; seconds: number; queries: number; onZetaris: number; parity: boolean; root: string; chain: string[]; explanationVia: string; planVia: string; redteamVia: string; guard: { checked: number; verified: number }; objections: { objection: string; result: string }[] }
export interface NightshiftRun { at: string; url: string; models: string[]; planVia: string; explanationVia: string; redteamVia: string; seconds: number; guard: { checked: number; verified: number }; request: { model: string; ms: number; tokens: number | null } }
export const L = live as unknown as { live: LiveRun | null; nightshift: NightshiftRun | null };

/** Scene-local frame and word cues: rel("word", n) is when the nth "word" is spoken, scene-local. */
export function useCue(id: string) {
  const s = scene(id);
  const f = useCurrentFrame();
  const rel = (w: string, n = 0) => wordAt(id, w, n) - s.from;
  return { s, f, rel, dur: s.durationInFrames };
}

export const Fill: React.FC<{ tone: Tone; children: React.ReactNode; bg?: string }> = ({ tone, children, bg }) => (
  <AbsoluteFill style={{ background: bg ?? TONE[tone].bg, fontFamily: sans, color: TONE[tone].ink, overflow: "hidden" }}>{children}</AbsoluteFill>
);

/** Small mono kicker with the brand's red square. */
export const Kicker: React.FC<{ children: React.ReactNode; color?: string; dot?: string; size?: number; style?: React.CSSProperties }> = ({ children, color = "rgba(242,239,231,0.62)", dot = C.signal, size = 16, style }) => (
  <div style={{ fontFamily: mono, fontSize: size, fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color, display: "flex", alignItems: "center", gap: 12, ...style }}>
    <span style={{ width: 9, height: 9, background: dot }} />{children}
  </div>
);

/** Fade, rise and un-blur for any block. */
export const In: React.FC<{ at: number; dur?: number; y?: number; x?: number; children: React.ReactNode; style?: React.CSSProperties; out?: number }> = ({ at, dur = 16, y = 24, x = 0, children, style, out }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [at, at + dur], [0, 1], { ...clamp, easing: expo });
  const o = out != null ? interpolate(f, [out, out + 10], [1, 0], clamp) : 1;
  return <div style={{ opacity: p * o, transform: `translate(${(1 - p) * x}px, ${(1 - p) * y}px)`, filter: p < 1 ? `blur(${(1 - p) * 6}px)` : undefined, ...style }}>{children}</div>;
};

/** A card that pops in at `at`; light cards on paper, dark cards on night. */
export const Card: React.FC<{ at: number; left: number; top: number; width: number; light?: boolean; accent?: string; children: React.ReactNode; style?: React.CSSProperties; out?: number }> = ({ at, left, top, width, light, accent, children, style, out }) => {
  const f = useCurrentFrame();
  const p = pop(f, at);
  const o = interpolate(f, [at, at + 8], [0, 1], clamp) * (out != null ? interpolate(f, [out, out + 10], [1, 0], clamp) : 1);
  return (
    <div style={{
      position: "absolute", left, top, width, opacity: o, transform: `translateY(${(1 - p) * 26}px) scale(${0.95 + 0.05 * p})`, transformOrigin: "50% 100%",
      background: light ? C.sheet : C.panel, color: light ? C.ink : C.paper, padding: "22px 26px", borderRadius: 14,
      boxShadow: light ? "0 0 0 1px rgba(26,23,20,0.09), 0 24px 56px rgba(60,40,20,0.14)" : "0 0 0 1px rgba(242,239,231,0.1), 0 30px 70px rgba(0,0,0,0.5)",
      borderTop: accent ? `3px solid ${accent}` : undefined, fontFamily: sans, ...style,
    }}>{children}</div>
  );
};

/** Big display type in IBM Plex Sans, tightly kerned. */
export const Head: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 92, style }) => (
  <div style={{ fontFamily: sans, fontWeight: 500, fontSize: size, letterSpacing: "-0.04em", lineHeight: 1.04, ...style }}>{children}</div>
);

/** A small mono label for sources and honesty notes. */
export const Note: React.FC<{ children: React.ReactNode; color?: string; size?: number; style?: React.CSSProperties }> = ({ children, color, size = 15, style }) => (
  <div style={{ fontFamily: mono, fontSize: size, letterSpacing: "0.08em", color, ...style }}>{children}</div>
);

/** The label every scene showing the reference case carries. */
export const SIM = "REFERENCE CASE · VOLTRIDE IS A SIMULATED COMPANY";

/** 0 -> 1 eased between scene-local frames a and a + d. */
export const ease = (f: number, a: number, d = 18) => interpolate(f, [a, a + d], [0, 1], { ...clamp, easing: expo });
export const fade = (f: number, a: number, d = 12) => interpolate(f, [a, a + d], [1, 0], clamp);

export const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
/** "2020-10-30" or "10/30/2020" -> "30 Oct 2020". */
export const day = (d: string) => {
  const m = d.includes("/") ? d.split("/") : null;
  const iso = m ? (m[2].length === 4 ? `${m[2]}-${m[0].padStart(2, "0")}-${m[1].padStart(2, "0")}` : `${m[2]}-${m[1]}-${m[0]}`) : d;
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
