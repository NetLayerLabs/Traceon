// Accuracy benchmark: runs the agent blind on hidden random scenarios and
// scores it against the planted truth. A run is correct when it finds exactly
// the planted causes AND the gate allows action iff a cause exists.
// Usage: npm run eval -- [count=100] [firstSeed=1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.METERLESS_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-eval-'));
globalThis.fetch = (async () => {
  throw new Error('offline benchmark');
}) as typeof fetch;
const { runInvestigation } = await import('../src/lib/investigation.ts');

const count = Number(process.argv[2] ?? 100);
const first = Number(process.argv[3] ?? 1);
const ids = ['reference', 'firmware', 'two-causes', 'noise', ...Array.from({ length: count }, (_, i) => `random-${first + i}`)];
let correct = 0;
let wrongButBlocked = 0;
let wrongAndActed = 0;
const byKind = new Map<string, { n: number; ok: number }>();
for (const id of ids) {
  const events: any[] = [];
  await runInvestigation((e) => events.push(e), { scenarioId: id, pacingMs: 0, vision: null });
  const r = events.find((e) => e.type === 'reveal').data;
  const kind = r.truth.length === 0 ? 'no defect' : r.truth.length > 1 ? 'two causes' : r.truth[0].column;
  const k = byKind.get(kind) ?? { n: 0, ok: 0 };
  k.n++;
  if (r.correct) {
    correct++;
    k.ok++;
  } else if (r.gateBlocked) wrongButBlocked++;
  else wrongAndActed++;
  byKind.set(kind, k);
  if (!r.correct) console.log(`MISS ${id}: planted ${JSON.stringify(r.truth)} found ${JSON.stringify(r.found)} gate ${r.gateBlocked ? 'blocked' : 'allowed'}`);
}
console.log(`\n${correct}/${ids.length} correct (${((correct / ids.length) * 100).toFixed(1)}%)`);
console.log(`wrong but safely blocked: ${wrongButBlocked} · wrong and acted: ${wrongAndActed}`);
for (const [kind, k] of [...byKind.entries()].sort()) console.log(`  ${kind.padEnd(14)} ${k.ok}/${k.n}`);
