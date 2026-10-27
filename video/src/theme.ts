import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadSerif } from "@remotion/google-fonts/Newsreader";

/** The app's three families (src/app/layout.tsx): IBM Plex Sans, IBM Plex Mono and Newsreader. */
export const sans = loadSans("normal", { weights: ["300", "400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const serif = loadSerif("italic", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
export const serifRoman = loadSerif("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;

/** Traceon's palette, from src/app/globals.css, plus a deeper night for the dark scenes. */
export const C = {
  paper: "#f2efe7",
  sheet: "#faf8f3",
  ink: "#1a1714",
  night: "#12100e",
  panel: "#1c1916",
  raised: "#25211d",
  muted: "#776f63",
  faint: "#a1998b",
  rule: "#ddd6c8",
  signal: "#c23d17",
  signalHi: "#e4572e",
  signalInk: "#9e2f10",
  signalSoft: "#f5e2d8",
  ochre: "#94660f",
  ochreHi: "#d39b2c",
  ochreSoft: "#efe4cb",
  ok: "#2c6a4c",
  okHi: "#4fa37a",
  okSoft: "#dfeae2",
  link: "#1d4f8a",
  /** Sponsor colours, from their own logo files. */
  zetaris: "#4654e8",
  nvidia: "#76b900",
};

export type Tone = "dark" | "light" | "brand";
export const TONE: Record<Tone, { bg: string; ink: string; muted: string; faint: string; line: string; pill: string; accent: string }> = {
  dark: { bg: C.night, ink: C.paper, muted: "rgba(242,239,231,0.62)", faint: "rgba(242,239,231,0.38)", line: "rgba(242,239,231,0.14)", pill: "rgba(18,16,14,0.66)", accent: C.signalHi },
  light: { bg: C.paper, ink: C.ink, muted: "rgba(26,23,20,0.58)", faint: "rgba(26,23,20,0.36)", line: "rgba(26,23,20,0.12)", pill: "rgba(250,248,243,0.86)", accent: C.signal },
  brand: { bg: C.signal, ink: C.paper, muted: "rgba(242,239,231,0.78)", faint: "rgba(242,239,231,0.5)", line: "rgba(242,239,231,0.24)", pill: "rgba(110,30,8,0.45)", accent: C.paper },
};

export const SCENE_TONE: Record<string, Tone> = {
  open: "dark", problem: "light", zetaris: "dark", turn: "light", converge: "dark", screen: "light", why: "dark",
  prove: "light", act: "dark", nightshift: "dark", real: "light", proof: "dark", different: "brand", close: "light",
};
