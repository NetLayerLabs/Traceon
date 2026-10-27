// Music bed -> public/audio/music.mp3, sized to src/timing.json totalFrames/30 + 2s.
//   node scripts/music.mjs            (skips if music.mp3 exists; FORCE=1 to redo)
// Path A: ElevenLabs Music API (POST /v1/music). Path B (fallback): several looped
// sound-generation beds stitched with ffmpeg crossfades. Writes .cache/music.json
// { source, bpm, offsetSec } for timing.mjs (beats).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, post, retry } from "./env.mjs";

const OUT = join(ROOT, "public/audio/music.mp3");
const META = join(ROOT, ".cache/music.json");
mkdirSync(join(ROOT, ".cache/music"), { recursive: true });
const timing = existsSync(join(ROOT, "src/timing.json")) ? JSON.parse(readFileSync(join(ROOT, "src/timing.json"), "utf8")) : { totalFrames: 3540 };
const seconds = Math.ceil(timing.totalFrames / 30 + 2);

const PROMPT =
  "Cinematic documentary score for a product-safety investigation film about lithium battery fires and an AI that proves the real cause, about 100 BPM, serious, precise and trustworthy, no vocals. " +
  "0-20s: night, hush and dread: a low sub drone, sparse felt piano notes, a faint slow heartbeat pulse, distant air. 20-25s: almost nothing, one held high note, very still. " +
  "25-44s: tension builds: a pulsing low synth ostinato, soft ticking percussion, uneasy and restless. " +
  "44-57s: glassy arpeggiated plucks enter like separate data streams joining, building; 53-57s a clean airy riser. " +
  "At 57.5s: a bright, clean hit and release into a confident investigative groove. " +
  "58-155s: precise modern electronic groove, crisp tight percussion, warm analog bass, glassy plucks and soft strings, restrained and intelligent, building gradually in layers; 93-114s more focused with light suspense; 141-155s a technical shimmer. " +
  "155-184s: weightier and more serious, documentary strings over the groove, grounded. 184-195s: steady and exact, ticking hi-hats. " +
  "195-210s: the arrangement lifts and opens wide, brighter, more energy, a sense of clarity. " +
  "210-226s: resolves on a warm final chord and one soft final hit at about 222s, then a short airy tail. No vocals, no lyrics.";

const ff = (a) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a]);
const dur = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString());

// Rough BPM + first-beat offset from an onset envelope (low-passed energy, 10ms hops) via autocorrelation.
function detectBpm(file) {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-t", "60", "-ac", "1", "-ar", "8000", "-af", "lowpass=f=200", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const hop = 80; // 10ms
  const env = [];
  for (let i = 0; i + hop <= s.length; i += hop) { let e = 0; for (let j = 0; j < hop; j++) e += s[i + j] * s[i + j]; env.push(Math.sqrt(e / hop)); }
  const on = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  let best = { bpm: 100, score: -1 };
  for (let bpm = 80; bpm <= 140; bpm += 0.5) {
    const lag = 6000 / bpm; // in 10ms hops
    let sc = 0;
    for (let i = 0; i + lag * 2 < on.length; i++) sc += on[i] * (on[Math.round(i + lag)] + on[Math.round(i + 2 * lag)]);
    if (sc > best.score) best = { bpm, score: sc };
  }
  // phase: best offset within one beat
  const lag = 6000 / best.bpm;
  let ph = { off: 0, sc: -1 };
  for (let o = 0; o < lag; o++) { let sc = 0; for (let t = o; t < on.length; t += lag) sc += on[Math.round(t)] || 0; if (sc > ph.sc) ph = { off: o, sc }; }
  return { bpm: best.bpm, offsetSec: +(ph.off / 100).toFixed(3) };
}

// The score follows the film: one section per stretch of scenes, sized from src/timing.json,
// so the logo hit, the lift and the resolve land on the picture.
const sceneAt = (id) => timing.scenes?.find((s) => s.id === id);
const at = (id) => (sceneAt(id) ? sceneAt(id).from / 30 : null);
function plan() {
  const total = seconds;
  const marks = [
    ["Night", 0, ["dark ambient", "low sub drone", "sparse felt piano notes", "a faint slow heartbeat pulse", "hushed dread"]],
    ["Still", (at("open") ?? 0) + 20.2, ["near silence", "one held high synth note", "very still"]],
    ["Trail", at("problem"), ["pulsing low synth ostinato", "soft ticking percussion", "uneasy", "tension building"]],
    ["Converge", at("zetaris"), ["glassy arpeggiated plucks", "separate lines joining", "building", "an airy riser at the end"]],
    ["Groove", at("turn") + 1.0, ["one bright clean hit at the very start", "confident investigative electronic groove", "100 bpm", "crisp tight percussion", "warm analog bass", "glassy plucks", "restrained"]],
    ["Focus", at("why"), ["focused", "light suspense", "the groove continues", "soft strings join"]],
    ["Shimmer", at("nightshift"), ["technical shimmer", "modern", "steady groove"]],
    ["Documentary", at("real"), ["weightier", "serious documentary strings over the groove", "grounded"]],
    ["Exact", at("proof"), ["steady and exact", "ticking hi-hats", "minimal"]],
    ["Lift", at("different"), ["the arrangement lifts and opens wide", "brighter", "more energy", "a sense of clarity"]],
    ["Resolve", at("close"), ["resolves on a warm final chord", "one soft final hit", "a short airy tail"]],
  ];
  const sections = marks.map(([name, from, styles], i) => {
    const to = i + 1 < marks.length ? marks[i + 1][1] : total;
    return { section_name: name, positive_local_styles: styles, negative_local_styles: ["vocals", "lyrics"], duration_ms: Math.round((to - from) * 1000), lines: [] };
  });
  return {
    positive_global_styles: ["cinematic documentary score", "modern electronic with soft strings", "serious, precise and trustworthy", "instrumental"],
    negative_global_styles: ["vocals", "lyrics", "singing", "choir", "comedy"],
    sections,
  };
}

// Three parts, generated a little long and spliced on the cut points by their measured onsets,
// so the cold open stays hushed, the hit lands on "This is Traceon" and the lift on "What makes".
function rms(file, hop = 0.1) {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const n = Math.round(8000 * hop), out = [];
  for (let i = 0; i + n <= s.length; i += n) { let e = 0; for (let j = 0; j < n; j++) e += s[i + j] * s[i + j]; out.push(20 * Math.log10(Math.sqrt(e / n) / 32768 + 1e-9)); }
  return out;
}
/** First time (s) the level rises above `db` and stays there for a second: the part's real downbeat. */
function onset(file, db) {
  const r = rms(file);
  for (let i = 0; i + 10 < r.length; i++) if (r.slice(i, i + 10).every((v) => v > db)) return i / 10;
  return 0;
}
// Parts in one key and tempo, joined on scene cuts (where a whoosh and a dissolve already sit).
// Each is generated a little long, aligned on its measured onset, and regenerated (up to 3
// takes) if its slot holds a silent gap; the take with the fewest silent tenths wins.
const KEY = "in D minor at 100 BPM";
const PARTS = [
  ["dark", null, "turn", false, `Dark, hushed cinematic documentary underscore about a battery fire at night, ${KEY}. It opens almost silent: a low sub drone, sparse felt piano notes, a faint slow heartbeat pulse. No drums for the first 26 seconds. From 26 seconds a pulsing low synth ostinato and soft ticking enter and the tension builds steadily. From 44 seconds glassy arpeggiated plucks join, like separate data streams converging, building to the end with an airy riser. Continuous, no breaks, no fade out. Instrumental, no vocals.`],
  ["groove1", "turn", "prove", true, `A confident, intelligent investigative electronic groove ${KEY} that starts immediately at full energy with one bright, clean cinematic hit on the very first beat: crisp tight percussion, warm analog bass, glassy plucks, restrained and precise. Continuous from start to end: no intro, no breaks, no breakdown, no ending. Instrumental, no vocals.`],
  ["groove2", "prove", "real", true, `The same investigative electronic groove ${KEY}, determined and steady with a little more drive: crisp tight percussion, warm analog bass, glassy plucks and soft strings. Starts immediately at full energy. Continuous from start to end: no intro, no breaks, no breakdown, no ending. Instrumental, no vocals.`],
  ["doc", "real", "different", true, `Weightier documentary underscore ${KEY}: serious, grounded strings over a steady electronic pulse; in its last third it thins to an exact, ticking pulse. Starts immediately at full level. Continuous from start to end: no intro, no breaks, no ending. Instrumental, no vocals.`],
  ["resolve", "different", null, true, `The ending of a product film ${KEY}. It starts immediately bright, wide and uplifting with more energy and clarity, building for 16 seconds, then resolves on a warm final chord with one soft final hit and a long airy tail into silence. No intro. Instrumental, no vocals.`],
];

if (existsSync(OUT) && !process.env.FORCE) {
  console.log("music.mp3 exists (FORCE=1 to regenerate)");
} else {
  const cue = (id) => (id === null ? null : id === "turn" ? at("turn") + 1.0 : at(id) + (id === "different" ? 0.3 : 0));
  const file = (name, k) => join(ROOT, ".cache/music", `${name}${k ? `-${k}` : ""}.mp3`);
  const force = (name) => process.env.FORCE === "all" || process.env.FORCE.split(",").includes(name);
  const chosen = [];
  for (const [name, fromId, toId, align, prompt] of PARTS) {
    const from = fromId === null ? 0 : cue(fromId), to = toId === null ? seconds : cue(toId);
    const slot = to - from;
    let best = null;
    for (let take = 1; take <= 3; take++) {
      const f = file(name, take);
      if (!existsSync(f) || (force(name) && take === 1) || (force(name) && !best?.fresh)) {
        const buf = await retry(async () => {
          const res = await post("/music?output_format=mp3_44100_128", { prompt, music_length_ms: Math.round((slot + (align ? 12 : 3)) * 1000), force_instrumental: true });
          return Buffer.from(await res.arrayBuffer());
        }, 2);
        writeFileSync(f, buf);
      }
      const r = rms(f);
      const on = align ? onset(f, -26) : 0;
      const a = Math.round(on * 10), b = Math.min(r.length, a + Math.round(slot * 10));
      const short = Math.max(0, a + Math.round(slot * 10) - r.length);
      const gaps = r.slice(fromId === null ? a + 30 : a, b).filter((v) => v < -42).length + short;
      console.log(`${name} take ${take}: onset ${on}s, ${gaps} silent tenths in its ${slot.toFixed(1)}s slot`);
      if (!best || gaps < best.gaps) best = { f, on, gaps, fresh: true };
      if (gaps <= 3) break;
    }
    chosen.push({ name, from, to, ...best });
  }
  // Splice: each part trimmed to [onset, onset + slot] (+ overlap), then chained with short crossfades.
  const X = { groove1: 0.08, groove2: 0.6, doc: 0.6, resolve: 0.8 };
  const inputs = chosen.flatMap((c) => ["-i", c.f]);
  let fc = chosen.map((c, i) => {
    const next = chosen[i + 1];
    const len = c.to - c.from + (next ? X[next.name] : 0);
    return `[${i}:a]atrim=${Math.max(0, c.on - (i ? 0.03 : 0)).toFixed(3)}:${(c.on + len).toFixed(3)},asetpts=PTS-STARTPTS[p${i}]`;
  }).join(";");
  let prev = "p0";
  for (let i = 1; i < chosen.length; i++) { fc += `;[${prev}][p${i}]acrossfade=d=${X[chosen[i].name]}:c1=tri:c2=tri[j${i}]`; prev = `j${i}`; }
  fc += `;[${prev}]apad=whole_dur=${seconds},atrim=0:${seconds},afade=t=out:st=${(seconds - 1.5).toFixed(2)}:d=1.5[out]`;
  ff([...inputs, "-filter_complex", fc, "-map", "[out]", "-b:a", "192k", OUT]);
  console.log(chosen.map((c) => `${c.name} ${c.from.toFixed(1)}-${c.to.toFixed(1)}s from ${c.f.split("/").pop()} @${c.on}s`).join("\n"));
  var source = "elevenlabs-music-parts";
  const beat = detectBpm(OUT);
  writeFileSync(META, JSON.stringify({ source, ...beat, seconds }, null, 1));
}
const meta = JSON.parse(readFileSync(META, "utf8"));
console.log(`music.mp3 ${dur(OUT).toFixed(1)}s (target ${seconds}s) via ${meta.source}; bpm ~${meta.bpm}, first beat ${meta.offsetSec}s`);
console.log("re-run: node scripts/timing.mjs  (to write bpm/beats)");
