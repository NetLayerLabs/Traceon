// Live Nemotron check: vision on a photo, then one full investigation against
// the real models. Reports latency, which steps were live vs fallback, and
// whether the explanation passed the number guard.
// Usage: npm run nemotron:check -- [path/to/photo.png|jpg] [scenario]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
process.env.METERLESS_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-nim-'));
const { nemotronLive, NEMOTRON_MODEL, NEMOTRON_FAST_MODEL } = await import('../src/lib/nemotron.ts');
const { analyzeDefectPhoto } = await import('../src/lib/vision.ts');
const { runInvestigation } = await import('../src/lib/investigation.ts');

if (!nemotronLive()) {
  console.log('NVIDIA_API_KEY is not set in .env.local');
  process.exit(1);
}
console.log(`models: ${NEMOTRON_MODEL} (vision + explanation), ${NEMOTRON_FAST_MODEL} (planning + red team)\n`);

const photo = process.argv[2] ?? 'public/samples/ntsb-787-li-ion-battery.jpg';
const ext = path.extname(photo).slice(1).replace('jpg', 'jpeg');
const dataUrl = `data:image/${ext};base64,${fs.readFileSync(photo).toString('base64')}`;
let t = Date.now();
const vision = await analyzeDefectPhoto(dataUrl, 'VoltRide VR-48 48V E-Bike Battery Pack');
console.log(`VISION ${vision.live ? 'LIVE' : 'FALLBACK'} ${Date.now() - t}ms`);
console.log(`  ${vision.physicalFailureMode} | ${vision.suspectedComponent} | severity ${vision.severityScore} | mfg defect: ${vision.isManufacturingDefectLikely}`);
console.log(`  bbox ${JSON.stringify(vision.bbox)}`);
if (!vision.live) console.log(`  reason: ${vision.reasoning}`);

t = Date.now();
const phases: string[] = [];
let last = Date.now();
const events: any[] = [];
await runInvestigation(
  (e: any) => {
    events.push(e);
    if (e.type === 'phase') {
      phases.push(`${e.phase} +${Date.now() - last}ms`);
      last = Date.now();
    }
  },
  { scenarioId: process.argv[3] ?? 'reference', vision, pacingMs: 0 }
);
const one = (type: string) => events.filter((e) => e.type === type).at(-1);
console.log(`\nINVESTIGATION ${Date.now() - t}ms`);
console.log(`  plan: ${one('plan').source} | red team: ${one('redteam')?.source ?? 'n/a'} | explanation: ${one('narrative').source}`);
console.log(`  plan order: ${one('plan').hypotheses.map((h: any) => h.id).join(' > ')}`);
console.log(`  plan reasoning: ${one('plan').reasoning.slice(0, 200)}`);
console.log(`  untestable: ${JSON.stringify(one('plan').untestable)}`);
for (const o of one('redteam')?.objections ?? []) console.log(`  red team [${o.check}] ${o.check === 'untestable' ? 'open question' : o.survived ? 'answered' : 'NOT ANSWERED'}: ${o.objection}`);
for (const l of events.filter((e) => e.type === 'log' && e.tone === 'model')) console.log(`  ${l.text}`);
const n = one('narrative');
console.log(`  number guard: ${n.guard.verified}/${n.guard.checked} verified${n.guard.unverified.length ? `, UNVERIFIED: ${n.guard.unverified.join(', ')}` : ''}`);
console.log(`  reasoning trace: ${n.reasoning.length} chars`);
console.log(`  gate: ${one('gate').pass ? 'PASS' : 'BLOCKED'} | reveal correct: ${one('reveal').data.correct}`);
console.log(`  phase timings: ${phases.join(', ')}`);
console.log(`\n--- explanation ---\n${n.text}`);
