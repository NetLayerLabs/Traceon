import React from "react";
import { C, mono, sans } from "../theme";
import { Brackets } from "../ui/Brackets";
import { Count } from "../ui/Count";
import { Words } from "../ui/Words";
import { Fill, In, Kicker, R, ease, useCue } from "./common";

/** Three claims, each with its proof. Blind accuracy is the app's eval (README); the rest is real.json. */
export const Different: React.FC = () => {
  const { f, rel } = useCue("different");
  const tWhat = rel("What"), tProves = rel("proves"), tShows = rel("shows"), tHolds = rel("holds");
  const claims = [
    { at: tProves, head: "It proves before it acts.", accent: "acts.", proof: <><Count to={304} at={tProves + 14} dur={30} /> / 304 blind cases correct · 0 wrong actions</> },
    { at: tShows, head: "It shows its work.", accent: "work.", proof: <>every one of the {R.reference.sqlQueries} queries replays to the same root</> },
    { at: tHolds, head: "It holds up on real data.", accent: "real", proof: <>Bolt EV fires flagged {R.bolt.leadDays} days before the recall · {R.backblaze.drives.toLocaleString("en-US")} real drives</> },
  ];
  return (
    <Fill tone="brand">
      <div style={{ position: "absolute", left: 160, top: 110 }}>
        <In at={0}><Kicker color="rgba(242,239,231,0.8)" dot={C.paper}>What makes it different</Kicker></In>
        <div style={{ marginTop: 20, fontFamily: sans, fontWeight: 500, fontSize: 92, letterSpacing: "-0.045em", lineHeight: 1, color: C.paper }}>
          <Words text="What makes Traceon different?" at={tWhat - 2} every={3} accent={{ "different?": C.paper }} />
        </div>
      </div>
      {claims.map((c, i) => {
        const y = 360 + i * 196;
        return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: 200, top: y, width: 1500 }}>
              <div style={{ fontFamily: sans, fontWeight: 500, fontSize: 64, letterSpacing: "-0.04em", lineHeight: 1.05, color: C.paper }}>
                <Words text={c.head} at={c.at - 6} every={3} accent={{ [c.accent]: C.paper }} />
              </div>
              <div style={{ marginTop: 14, fontFamily: mono, fontSize: 24, letterSpacing: "0.02em", color: "rgba(242,239,231,0.86)", opacity: ease(f, c.at + 8, 14) }}>{c.proof}</div>
            </div>
            <Brackets box={{ x: 168, y: y - 18, w: 1560, h: 150 }} lock={ease(f, c.at - 4, 14)} release={i < 2 ? ease(f, claims[i + 1].at - 6, 14) : 0} color={C.paper} releaseColor="rgba(242,239,231,0.4)" stroke={3} arm={30} gap={34} />
          </React.Fragment>
        );
      })}
    </Fill>
  );
};
