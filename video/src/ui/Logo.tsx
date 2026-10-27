import React from "react";
import { Img, staticFile } from "remotion";
import { C } from "../theme";

/** The real logos, unaltered: our own, the sponsors', the data provider's, the host's and the team's. */
const FILES = {
  traceon: ["brand/traceon-logo.png", 882 / 160],
  traceonLockup: ["brand/traceon-lockup.png", 1199 / 240],
  zetaris: ["logos/zetaris-indigo.svg", 747.12 / 207.49],
  nvidia: ["logos/nvidia.svg", 262 / 48],
  meterless: ["logos/meterless-dark.svg", 774 / 72],
  meterlessLight: ["logos/meterless-light.svg", 774 / 72],
  meterlessIcon: ["logos/meterless-icon.svg", 1],
  brightdata: ["logos/brightdata.svg", 179 / 40],
  genai: ["logos/genai-works.svg", 101.117 / 23.0698],
  netlayer: ["brand/netlayer-header.png", 2172 / 724],
} as const;
export type LogoName = keyof typeof FILES;

export const Logo: React.FC<{ name: LogoName; height: number; style?: React.CSSProperties }> = ({ name, height, style }) => {
  const [file, ratio] = FILES[name];
  return <Img src={staticFile(file)} style={{ height, width: height * ratio, display: "block", ...style }} />;
};

/** A logo on a paper chip, so the original colours read on a dark or red scene. */
export const LogoChip: React.FC<{ name: LogoName; height: number; pad?: number; style?: React.CSSProperties }> = ({ name, height, pad = 18, style }) => (
  <div style={{ background: C.sheet, borderRadius: 16, padding: `${pad}px ${pad * 1.5}px`, display: "inline-flex", alignItems: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.25)", ...style }}>
    <Logo name={name} height={height} />
  </div>
);
