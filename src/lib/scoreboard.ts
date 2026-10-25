// Model-versus-statistics scoreboard: every investigation where Nemotron
// ranked the suspects records whether its first guess survived the
// statistics, and (on generated data, where the truth is known) which of the
// two was right.
import fs from 'node:fs';
import path from 'node:path';

export interface ScoreRecord {
  at: string;
  scenarioId: string;
  modelTop: string; // Nemotron's top-ranked hypothesis id
  modelTopTitle: string;
  statsConfirmed: string[]; // hypothesis ids the statistics confirmed
  agreed: boolean; // the model's top guess is among the confirmed causes
  truthKnown: boolean;
  modelTopCorrect: boolean | null; // the model's top guess is a planted cause
  statsCorrect: boolean | null; // the statistics found exactly the planted causes (or none)
}

const file = () =>
  path.join(process.env.METERLESS_STORAGE_DIR || (process.env.VERCEL ? '/tmp/meterless-data' : path.join(process.cwd(), '.meterless-data')), 'scoreboard.json');

export function readScoreboard(): ScoreRecord[] {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf-8'));
  } catch {
    return [];
  }
}

export function recordScore(r: ScoreRecord) {
  const all = readScoreboard();
  all.push(r);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(all.slice(-500), null, 1));
  } catch {
    // A read-only filesystem keeps no scoreboard.
  }
}

export function summarizeScoreboard() {
  const all = readScoreboard();
  const known = all.filter((r) => r.truthKnown);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
  return {
    runs: all.length,
    agreed: all.filter((r) => r.agreed).length,
    overruled: all.filter((r) => !r.agreed).length,
    withTruth: known.length,
    modelTopCorrect: known.filter((r) => r.modelTopCorrect).length,
    statsCorrect: known.filter((r) => r.statsCorrect).length,
    modelTopCorrectPct: pct(known.filter((r) => r.modelTopCorrect).length, known.length),
    statsCorrectPct: pct(known.filter((r) => r.statsCorrect).length, known.length),
    recent: all.slice(-12).reverse(),
  };
}
