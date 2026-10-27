import React from "react";
import { interpolate } from "remotion";
import { C, mono, sans, serif } from "../theme";
import { clamp, expo, pop } from "../ui/motion";
import { Brackets } from "../ui/Brackets";
import { Count } from "../ui/Count";
import { Trace } from "../ui/Trace";
import { Words } from "../ui/Words";
import { Fill, In, Kicker, Note, R, SIM, ease, useCue } from "./common";

const H = (id: string) => R.reference.hypotheses.find((h) => h.id === id)!;
/** The seven suspects, with the app's own labels, raw p and p holding the batch fixed. */
const CARDS = [
  { id: "H-FW", name: "Firmware", group: "v3.3" },
  { id: "H-CARRIER", name: "Carrier", group: "UPS" },
  { id: "H-HEAT", name: "Heat", group: "Sun Belt" },
  { id: "H-PLANT", name: "Plant", group: "P2" },
  { id: "H-BMS", name: "BMS board", group: "BMS-Orion" },
  { id: "H-SUPPLIER", name: "Supplier", group: "Supplier B" },
  { id: "H-BATCH", name: "Cell batch", group: "CB-B-0917" },
];
/** "p = 1.6e-6" -> "1.6 × 10⁻⁶" (superscript exponent). */
const sci = (label: string | null) => {
  if (!label) return "";
  const m = label.match(/([<=])\s*([\d.]+)e-(\d+)/);
  if (!m) return label.replace("p = ", "");
  const sup = m[3].split("").map((d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+d]).join("");
  return `${m[1] === "<" ? "< " : ""}${m[2] === "1" ? "" : m[2] + " × "}10⁻${sup}`;
};

export const Why: React.FC = () => {
  const { f, rel } = useCue("why");
  const tHeat = rel("heat"), tHold = rel("Hold"), tVan = rel("vanishes."), tPlant = rel("plant,"), tBms = rel("BMS"), tSup = rel("supplier."), tOne = rel("One"), tSingle = rel("single"), tSixteen = rel("sixteen");
  const cw = 222, ch = 196, gap = 20, x0 = (1920 - (7 * cw + 6 * gap)) / 2, y0 = 300;
  const box = (i: number) => ({ x: x0 + i * (cw + gap), y: y0, w: cw, h: ch });
  const releaseAt: Record<string, number> = { "H-HEAT": tVan, "H-PLANT": tPlant, "H-BMS": tBms, "H-SUPPLIER": tSup };
  const holdBar = ease(f, tHold - 4, 18);
  const cause = R.reference.cause;
  const end = ease(f, tSingle - 8, 20);

  return (
    <Fill tone="dark">
      <div style={{ position: "absolute", left: x0, top: 96 }}>
        <In at={0}><Kicker>Explain why · hold every other factor fixed</Kicker></In>
        <div style={{ marginTop: 18, fontFamily: sans, fontWeight: 500, fontSize: 60, letterSpacing: "-0.04em", color: C.paper }}>
          <Words text="On raw numbers, heat looks guilty." at={rel("On") - 2} every={3} accent={{ "guilty.": C.signalHi }} />
        </div>
      </div>

      {CARDS.map((c, i) => {
        const h = H(c.id);
        const b = box(i);
        const ruledOut = h.status === "NO_ASSOCIATION";
        const isCause = c.id === "H-BATCH";
        const rel0 = releaseAt[c.id];
        const let_ = rel0 != null ? ease(f, rel0 - 2, 16) : 0;
        const p = pop(f, 4 + i * 4);
        const adj = rel0 != null && f >= rel0 - 2;
        const hatch = let_ > 0 ? `repeating-linear-gradient(135deg, rgba(211,155,44,${0.16 * let_}) 0 10px, transparent 10px 20px)` : undefined;
        return (
          <div key={c.id} style={{
            position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 12, padding: "18px 18px",
            background: isCause && f >= tSingle - 6 ? "#2a1610" : C.panel, backgroundImage: hatch,
            boxShadow: `0 0 0 1px ${isCause && f >= tSingle - 6 ? "rgba(228,87,46,0.6)" : "rgba(242,239,231,0.1)"}`,
            opacity: Math.min(1, p * 1.3) * (ruledOut ? 0.45 : 1), transform: `translateY(${(1 - p) * 22}px)`,
          }}>
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 25, color: C.paper }}>{c.name}</div>
            <div style={{ marginTop: 4, fontFamily: mono, fontSize: 14, letterSpacing: "0.06em", color: "rgba(242,239,231,0.55)" }}>{c.group.toUpperCase()}</div>
            <div style={{ position: "absolute", left: 18, bottom: 18 }}>
              <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.12em", color: "rgba(242,239,231,0.45)" }}>{adj ? "BATCH HELD FIXED" : "RAW P"}</div>
              <div style={{ marginTop: 4, fontFamily: mono, fontWeight: 500, fontSize: 26, color: ruledOut ? "rgba(242,239,231,0.6)" : adj ? C.ochreHi : C.signalHi }}>
                {adj ? (h.adjustedP ?? "").replace("p = ", "") : sci(h.rawP)}
              </div>
              <div style={{ marginTop: 4, fontFamily: serif, fontStyle: "italic", fontSize: 21, color: ruledOut ? "rgba(242,239,231,0.5)" : adj ? C.ochreHi : isCause && f >= tSingle - 6 ? C.signalHi : "transparent" }}>
                {ruledOut ? "no association" : adj ? "confounder" : isCause && f >= tSingle - 6 ? "the cause" : "."}
              </div>
            </div>
          </div>
        );
      })}

      {/* hold the batch fixed: two strata under the suspects */}
      <div style={{ position: "absolute", left: x0, top: y0 + ch + 40, width: 7 * cw + 6 * gap, opacity: holdBar * (1 - end) }}>
        <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: "rgba(242,239,231,0.55)" }}>HOLDING CELL BATCH FIXED (COCHRAN–MANTEL–HAENSZEL)</div>
        <div style={{ marginTop: 12, display: "flex", gap: 16 }}>
          {["Units in CB-B-0917", "Units in every other batch"].map((t, i) => (
            <div key={t} style={{ flex: 1, height: 58, borderRadius: 10, display: "flex", alignItems: "center", padding: "0 18px", fontFamily: sans, fontSize: 22, color: C.paper, background: i ? "rgba(242,239,231,0.06)" : "rgba(228,87,46,0.16)", transform: `scaleX(${0.8 + 0.2 * holdBar})`, transformOrigin: "0 50%" }}>{t}</div>
          ))}
        </div>
      </div>

      {/* the brackets: lock on heat, let go; then the cause */}
      {f < tSingle ? <Brackets box={box(2)} lock={ease(f, tHeat - 6, 14)} release={ease(f, tVan - 2, 18)} color={C.signalHi} releaseColor={C.ochreHi} stroke={4} arm={26} gap={44} /> : null}
      {[3, 4, 5].map((i) => {
        const t = [tPlant, tBms, tSup][i - 3];
        return <Brackets key={i} box={box(i)} lock={ease(f, t - 14, 8)} release={ease(f, t - 2, 16)} color={C.signalHi} releaseColor={C.ochreHi} stroke={4} arm={26} gap={30} />;
      })}
      <Brackets box={box(6)} lock={ease(f, tOne - 2, 16)} square={0} color={C.signalHi} stroke={5} arm={30} gap={60} />

      {/* the verdict */}
      <div style={{ position: "absolute", left: x0, top: y0 + ch + 44, width: 7 * cw + 6 * gap, opacity: end, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: "rgba(242,239,231,0.55)" }}>ONE CAUSE SURVIVES EVERY TEST</div>
          <div style={{ marginTop: 10, fontFamily: mono, fontWeight: 600, fontSize: 84, letterSpacing: "0.02em", color: C.signalHi }}>{cause.group}</div>
          <div style={{ marginTop: 6, fontFamily: sans, fontSize: 24, color: "rgba(242,239,231,0.75)" }}>
            Supplier B · lot {cause.lot.lot_id} · plant {cause.lot.plant_id} · serials SN-{cause.lot.serial_start}–{cause.lot.serial_end}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 120, letterSpacing: "-0.05em", lineHeight: 1, color: C.paper }}>
            <Count to={cause.rr} at={tSixteen - 4} dur={36} />×
          </div>
          <div style={{ marginTop: 8, fontFamily: sans, fontSize: 24, color: "rgba(242,239,231,0.75)" }}>
            {Math.round(cause.ratePer10k)} vs {cause.baseRatePer10k.toFixed(1)} failures per 10,000 · {(cause.coverage * 100).toFixed(1)}% of incidents
          </div>
        </div>
      </div>
      <Note color="rgba(242,239,231,0.4)" size={13} style={{ position: "absolute", left: x0, top: 900 }}>{SIM} · EVERY P-VALUE COMPUTED IN CODE, CHECKED AGAINST SCIPY</Note>
    </Fill>
  );
};
