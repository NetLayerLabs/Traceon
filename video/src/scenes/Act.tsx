import React from "react";
import { interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp } from "../ui/motion";
import { Brackets } from "../ui/Brackets";
import { Browser, syncTo } from "../ui/Footage";
import { Count } from "../ui/Count";
import { Fill, Kicker, Note, R, SIM, ease, useCue } from "./common";

/** A named person approves; Traceon holds the exact 1,380 units of lot L-409, not all 180,000. */
export const Act: React.FC = () => {
  const { f, rel } = useCue("act");
  const tApprove = rel("approve.");
  const tNamed = rel("named"), tHolds = rel("holds"), tNot = rel("not"), tSaves = rel("saves");
  const plan = R.reference.plan, lot = R.reference.cause.lot;
  // 180,000 units as 1,800 squares of 100; the 1,380 held are 14 of them, in one run (serials SN-88400..89779).
  const cols = 60, rows = 30, cell = 9, gx = 1250, gy = 420;
  const held = Math.round(plan.affectedUnits / 100);
  const start = 18 * cols + 22; // where the lot sits in serial order
  const lockP = ease(f, tHolds + 2, 16);
  const grey = interpolate(f, [tNot - 4, tNot + 12], [0, 1], clamp);
  const cr = { x: gx + 22 * cell - 6, y: gy + 18 * cell - 6, w: held * cell + 12, h: cell + 12 };
  return (
    <Fill tone="dark">
      <Browser name="act_local" url="localhost · this Mac · Traceon" width={1020} left={90} top={160}
        startFrom={syncTo("act_local", "act_local.approved", tApprove)}
        cams={[{ f: 0, rect: "approve", z: 1.7 }, { f: tNamed, rect: "approve", z: 1.8 }, { f: tHolds + 10, rect: "result", z: 1.5 }]} />
      <div style={{ position: "absolute", left: 1250, top: 150, width: 560 }}>
        <Kicker color="rgba(242,239,231,0.6)">A named person approves</Kicker>
        <div style={{ marginTop: 18, fontFamily: sans, fontWeight: 600, fontSize: 112, letterSpacing: "-0.05em", lineHeight: 1, color: C.signalHi }}>
          <Count to={plan.affectedUnits} at={tHolds} dur={26} />
        </div>
        <div style={{ marginTop: 6, fontFamily: sans, fontSize: 26, color: "rgba(242,239,231,0.8)", opacity: ease(f, tHolds + 6, 10) }}>
          units held, not <span style={{ color: C.paper }}>{plan.blanketUnits.toLocaleString("en-US")}</span>
        </div>
      </div>
      <svg style={{ position: "absolute", left: 0, top: 0 }} width={1920} height={1080}>
        {Array.from({ length: cols * rows }, (_, i) => {
          const c = i % cols, r = Math.floor(i / cols);
          const isHeld = i >= start && i < start + held;
          return <rect key={i} x={gx + c * cell} y={gy + r * cell} width={cell - 3} height={cell - 3} fill={isHeld && lockP > 0.2 ? C.signalHi : `rgba(242,239,231,${0.42 - 0.26 * grey})`} />;
        })}
      </svg>
      <Brackets box={cr} lock={lockP} color={C.signalHi} stroke={3} arm={10} gap={30} />
      <div style={{ position: "absolute", left: 1250, top: 700, width: 560, fontFamily: mono, fontSize: 16, lineHeight: 1.6, color: "rgba(242,239,231,0.62)", opacity: ease(f, tHolds + 12, 12) }}>
        LOT {lot.lot_id} · PLANT {lot.plant_id} · SN-{lot.serial_start}–{lot.serial_end}<br />EACH SQUARE IS 100 UNITS
      </div>
      <div style={{ position: "absolute", left: 1250, top: 772, opacity: ease(f, tSaves - 6, 14) }}>
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 76, letterSpacing: "-0.045em", color: C.paper }}><Count to={plan.savingsUsd} at={tSaves - 4} dur={30} prefix="$" /></div>
        <div style={{ fontFamily: sans, fontSize: 24, color: "rgba(242,239,231,0.72)" }}>saved against a blanket recall</div>
      </div>
      <Note color="rgba(242,239,231,0.4)" size={13} style={{ position: "absolute", left: 1250, top: 908 }}>{SIM}</Note>
    </Fill>
  );
};
