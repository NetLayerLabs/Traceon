import React from "react";
import { AbsoluteFill, Audio, Freeze, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { T, scene, wordAt } from "./timing";
import { C } from "./theme";
import { Poster } from "./Poster";
import { Captions } from "./ui/Captions";
import { Grain } from "./ui/Grain";
import { clamp } from "./ui/motion";
import { Open } from "./scenes/Open";
import { Problem } from "./scenes/Problem";
import { Zetaris } from "./scenes/Zetaris";
import { Turn } from "./scenes/Turn";
import { Converge } from "./scenes/Converge";
import { Screen } from "./scenes/Screen";
import { Why } from "./scenes/Why";
import { Prove } from "./scenes/Prove";
import { Act } from "./scenes/Act";
import { Nightshift } from "./scenes/Nightshift";
import { Real } from "./scenes/Real";
import { Proof } from "./scenes/Proof";
import { Different } from "./scenes/Different";
import { Close } from "./scenes/Close";

const SCENES: Record<string, React.FC> = {
  open: Open, problem: Problem, zetaris: Zetaris, turn: Turn, converge: Converge, screen: Screen, why: Why,
  prove: Prove, act: Act, nightshift: Nightshift, real: Real, proof: Proof, different: Different, close: Close,
};
export const TITLE = 30; // the thumbnail, one second, before the film
const OVERLAP = 12; // frames each scene starts early, to dissolve over the last

/** Each scene eases in (a short rise, un-blur and settle) over the tail of the previous one, holding its first frame. */
const SceneIn: React.FC<{ S: React.FC; first: boolean }> = ({ S, first }) => {
  const f = useCurrentFrame();
  if (first) return <S />;
  const p = interpolate(f, [0, OVERLAP], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const body = f < OVERLAP ? <Freeze frame={0}><S /></Freeze> : <Sequence from={OVERLAP} layout="none"><S /></Sequence>;
  return <AbsoluteFill style={{ opacity: p, transform: `scale(${1.035 - 0.035 * p})`, filter: p < 1 ? `blur(${(1 - p) * 10}px)` : undefined }}>{body}</AbsoluteFill>;
};

// --- Music, ducked under every spoken line.
const LINES = T.scenes.flatMap((s) => s.lines.map((l) => [l.startFrame, l.words[l.words.length - 1].end] as const));
const DUCK: number[] = (() => {
  const v = new Array<number>(T.totalFrames + 1).fill(0);
  for (let f = 0; f <= T.totalFrames; f++) {
    let d = 0;
    for (const [a, b] of LINES) d = Math.max(d, interpolate(f, [a - 10, a, b, b + 14], [0, 1, 1, 0], clamp));
    v[f] = d;
  }
  return v;
})();
const musicVolume = (f: number) => {
  const end = T.totalFrames;
  const fadeIn = interpolate(f, [0, 30], [0, 1], clamp);
  const fadeOut = interpolate(f, [end - 60, end], [1, 0], clamp);
  return (0.55 - 0.38 * DUCK[Math.min(end, Math.max(0, f))]) * fadeIn * fadeOut;
};

interface Fx { file: string; at: number; vol: number; dur?: number }
function effects(): Fx[] {
  const sc = (id: string) => scene(id).from;
  const w = (id: string, word: string, n = 0) => wordAt(id, word, n);
  const fx: Fx[] = [
    // open: the night, the alarm, the record, the recall, the owner
    ...[0, 1, 2].map((i) => ({ file: "tick", at: w("open", "Three") + i * 9, vol: 0.32 })),
    { file: "alarm", at: w("open", "alarms.") - 6, vol: 0.22, dur: 64 },
    { file: "teletype", at: w("open", "Their") - 4, vol: 0.32 },
    { file: "lock", at: w("open", "burning"), vol: 0.45 },
    { file: "pop", at: w("open", "report") - 2, vol: 0.32 },
    { file: "stamp", at: w("open", "recalls") - 2, vol: 0.4 },
    { file: "teletype", at: w("open", "writes:") - 2, vol: 0.3 },
    // problem: the trail splits, the suspects, the blanket recall
    { file: "whoosh", at: sc("problem") - 8, vol: 0.28 },
    ...["claims,", "reviews,", "federal", "factory"].map((x) => ({ file: "pop", at: w("problem", x) - 2, vol: 0.3 })),
    { file: "scan", at: w("problem", "suspect") - 4, vol: 0.28 },
    { file: "block", at: w("problem", "wrong.") - 2, vol: 0.35 },
    { file: "data", at: w("problem", "Recall") - 2, vol: 0.22 },
    // zetaris: five silos, one layer, a real query
    { file: "whoosh", at: sc("zetaris") - 8, vol: 0.28 },
    ...[0, 5, 10, 15, 20].map((d) => ({ file: "pop", at: w("zetaris", "five") + d, vol: 0.26 })),
    { file: "scan", at: w("zetaris", "Zetaris") - 4, vol: 0.38 },
    { file: "teletype", at: w("zetaris", "query") - 2, vol: 0.3 },
    { file: "chime", at: w("zetaris", "again.") - 2, vol: 0.28 },
    // turn: riser, hit, lock
    { file: "riser", at: w("turn", "Traceon.") - 92, vol: 0.4 },
    { file: "impact", at: w("turn", "Traceon.") - 4, vol: 0.55 },
    { file: "lock", at: w("turn", "Traceon.") + 4, vol: 0.5 },
    // converge
    { file: "whoosh", at: sc("converge") - 8, vol: 0.28 },
    { file: "data", at: w("converge", "pulls") - 2, vol: 0.25 },
    { file: "lock", at: w("converge", "incident:") - 2, vol: 0.45 },
    // screen
    { file: "whoosh", at: sc("screen") - 8, vol: 0.28 },
    { file: "data", at: w("screen", "query") - 2, vol: 0.28 },
    { file: "click", at: w("screen", "forty-six") - 2, vol: 0.4 },
    { file: "chime", at: w("screen", "does.") - 2, vol: 0.3 },
    // why: lock on heat, let it go, the same three times, lock on the batch
    { file: "whoosh", at: sc("why") - 8, vol: 0.28 },
    { file: "lock", at: w("why", "heat") - 2, vol: 0.45 },
    { file: "release", at: w("why", "vanishes.") - 2, vol: 0.45 },
    ...["plant,", "BMS", "supplier."].map((x) => ({ file: "release", at: w("why", x) - 2, vol: 0.35 })),
    { file: "lock", at: w("why", "single") - 2, vol: 0.55 },
    { file: "impact", at: w("why", "single") + 2, vol: 0.3 },
    // prove: objections, seven ticks, the block
    { file: "swoosh_up", at: sc("prove") - 8, vol: 0.3 },
    { file: "click", at: w("prove", "objections,") - 2, vol: 0.4 },
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ file: "tick", at: w("prove", "Seven") + 2 + i * 5, vol: 0.4 })),
    { file: "block", at: w("prove", "blocks") - 2, vol: 0.45 },
    // act
    { file: "whoosh", at: sc("act") - 8, vol: 0.28 },
    { file: "stamp", at: w("act", "approve.") - 2, vol: 0.5 },
    { file: "lock", at: w("act", "holds") + 4, vol: 0.45 },
    { file: "chime", at: w("act", "saves") - 2, vol: 0.32 },
    // nightshift
    { file: "whoosh", at: sc("nightshift") - 8, vol: 0.28 },
    { file: "scan", at: w("nightshift", "Nightshift,") - 4, vol: 0.32 },
    { file: "click", at: w("nightshift", "Lightning") - 2, vol: 0.38 },
    { file: "click", at: w("nightshift", "Ultra") - 2, vol: 0.38 },
    { file: "chime", at: w("nightshift", "wrote.") - 2, vol: 0.3 },
    // real
    { file: "swoosh_up", at: sc("real") - 8, vol: 0.3 },
    { file: "impact", at: w("real", "No.") - 2, vol: 0.32 },
    { file: "lock", at: w("real", "October") - 2, vol: 0.45 },
    { file: "block", at: w("real", "on.") - 2, vol: 0.3 },
    { file: "chime", at: w("real", "stopped.") - 2, vol: 0.32 },
    { file: "data", at: w("real", "hard") - 2, vol: 0.22 },
    { file: "lock", at: w("real", "cohort,") - 2, vol: 0.4 },
    { file: "block", at: w("real", "refuses") - 2, vol: 0.35 },
    // proof
    { file: "whoosh", at: sc("proof") - 8, vol: 0.28 },
    { file: "click", at: w("proof", "links") - 2, vol: 0.4 },
    { file: "teletype", at: w("proof", "hashed,") - 2, vol: 0.26 },
    { file: "click", at: w("proof", "replays") - 2, vol: 0.4 },
    { file: "chime", at: w("proof", "root.") - 2, vol: 0.35 },
    // different
    { file: "swoosh_up", at: sc("different") - 8, vol: 0.32 },
    ...["proves", "shows", "holds"].map((x) => ({ file: "impact", at: w("different", x) - 4, vol: 0.2 })),
    // close
    { file: "whoosh", at: sc("close") - 8, vol: 0.28 },
    { file: "lock", at: w("close", "Traceon.") - 2, vol: 0.45 },
    { file: "chime", at: w("close", "verdict.") + 6, vol: 0.32 },
  ];
  return fx.filter((x) => x.at >= 0 && x.at < T.totalFrames);
}

const TitleCard: React.FC = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: interpolate(f, [TITLE - 6, TITLE + 10], [1, 0], clamp) }}><Poster /></AbsoluteFill>;
};

/** Captions sit out where big type already carries the words. */
const NO_CAPTIONS = new Set(["turn", "different", "close"]);

export const Film: React.FC = () => {
  const hideCaptions = (f: number) => {
    const s = T.scenes.find((x) => f >= x.from && f < x.from + x.durationInFrames);
    return !s || NO_CAPTIONS.has(s.id);
  };
  return (
    <AbsoluteFill style={{ background: C.night }}>
      {/* The thumbnail opens the film for one second, then dissolves into the cold open. */}
      <Sequence durationInFrames={TITLE + 12} name="thumbnail">
        <TitleCard />
      </Sequence>
      <Sequence from={TITLE} name="film">
      <AbsoluteFill>
      {T.scenes.map((s, i) => {
        const S = SCENES[s.id];
        const from = i === 0 ? s.from : s.from - OVERLAP;
        const dur = s.durationInFrames + (i === 0 ? 0 : OVERLAP);
        return S ? (
          <Sequence key={s.id} from={from} durationInFrames={dur} name={s.id}>
            <SceneIn S={S} first={i === 0} />
          </Sequence>
        ) : null;
      })}
      <Grain opacity={0.05} />
      <Captions hidden={hideCaptions} />
      <Audio src={staticFile("audio/music.mp3")} volume={musicVolume} />
      {T.scenes.flatMap((s) => s.lines).map((l, i) => (
        <Sequence key={`vo${i}`} from={l.startFrame} durationInFrames={l.durationFrames} name={`vo ${l.text.slice(0, 18)}`}>
          <Audio src={staticFile(l.file)} volume={1} />
        </Sequence>
      ))}
      {effects().map((x, i) => (
        <Sequence key={`fx${i}`} from={x.at} durationInFrames={x.dur ?? 150} name={`fx ${x.file}`}>
          <Audio src={staticFile(`audio/sfx/${x.file}.mp3`)} volume={(f) => x.vol * (x.dur ? interpolate(f, [0, 8, x.dur - 20, x.dur], [0, 1, 1, 0], clamp) : 1)} />
        </Sequence>
      ))}
      </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
