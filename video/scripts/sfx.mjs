// Sound effects via ElevenLabs /v1/sound-generation. Skips files that already exist.
//   node scripts/sfx.mjs                 all missing
//   ONLY=lock,stamp node scripts/sfx.mjs   force regenerate some
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, post, retry } from "./env.mjs";

const SFX = {
  alarm: ["A residential smoke alarm beeping three times, heard through a wall at night, muffled and distant, no voices", 2.0],
  tick: ["Single crisp clock tick in a silent room, close, dry, short", 0.5],
  teletype: ["Soft quick dot-matrix printer printing one short line of text, close, dry, clean", 1.2],
  whoosh: ["Soft fast airy whoosh, smooth cinematic transition, no music", 1.0],
  swoosh_up: ["Quick rising digital swoosh, bright and clean, UI transition, no music", 0.9],
  click: ["Soft modern UI mouse click, single, clean, short", 0.5],
  pop: ["Soft clean UI pop as a card appears, single, short", 0.5],
  lock: ["Precise mechanical camera shutter and lock click, single, crisp, satisfying", 0.6],
  release: ["Soft descending glassy release tone, short, a lock opening, clean", 0.8],
  scan: ["Soft electronic scanning sweep, short, clean, digital, rising", 1.2],
  data: ["Fast soft digital data chatter, tiny ticks and blips like queries running, subtle, no music", 2.0],
  riser: ["Tension riser, rising airy synth swell building to a peak, cinematic, no drums", 3.0],
  impact: ["Deep clean cinematic impact with a warm sub tail, modern, single hit", 2.0],
  chime: ["Bright clean confirmation chime, two soft ascending notes, modern, short tail", 1.5],
  stamp: ["Firm soft rubber stamp hit on paper, single, close, dry", 0.6],
  block: ["Firm low digital denial thud, single, short, clean, like a gate refusing", 0.8],
};

const dir = join(ROOT, "public/audio/sfx");
mkdirSync(dir, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

for (const [name, [text, dur]] of Object.entries(SFX)) {
  const f = join(dir, `${name}.mp3`);
  if (only ? !only.includes(name) : existsSync(f)) { console.log(`${name}: skip`); continue; }
  try {
    const buf = await retry(async () => {
      const res = await post("/sound-generation?output_format=mp3_44100_128", { text, duration_seconds: dur, prompt_influence: 0.5 });
      return Buffer.from(await res.arrayBuffer());
    });
    writeFileSync(f, buf);
    console.log(`${name}: ${(buf.length / 1024).toFixed(0)}kb`);
  } catch (e) { console.error(`${name}: FAILED ${e.message}`); }
}
