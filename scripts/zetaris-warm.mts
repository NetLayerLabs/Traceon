// Warms the Zetaris cluster before a demo by running every query of the
// reference investigation once (about 46), as recommended for the hackathon
// clusters, and reports where each ran. Model calls are skipped so this only
// exercises Zetaris. Usage: npm run zetaris:warm
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
for (const k of ['NVIDIA_API_KEY', 'NIGHTSHIFT_TOKEN', 'NIGHTSHIFT_TOKEN_FILE', 'BRIGHTDATA_API_TOKEN']) delete process.env[k];
process.env.METERLESS_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-warm-'));
const { zetarisMode } = await import('../src/lib/zetaris.ts');
const { runInvestigation } = await import('../src/lib/investigation.ts');
if (zetarisMode() !== 'ZETARIS_CLOUD') {
  console.log('Zetaris is not configured in .env.local; nothing to warm.');
  process.exit(1);
}
const t = Date.now();
const events: any[] = [];
await runInvestigation((e) => events.push(e), { scenarioId: 'reference', pacingMs: 0, vision: null });
const evidence = events.filter((e) => e.type === 'done').at(-1).evidence.filter((e: any) => e.query);
const cloud = evidence.filter((e: any) => e.query.executedVia === 'ZETARIS_CLOUD');
const slowest = [...cloud].sort((a: any, b: any) => b.query.latencyMs - a.query.latencyMs).slice(0, 3);
console.log(`${cloud.length}/${evidence.length} queries ran on Zetaris in ${((Date.now() - t) / 1000).toFixed(1)} s`);
for (const e of slowest) console.log(`  slowest: ${e.query.latencyMs} ms  ${e.label}`);
const reasons = [...new Set(evidence.filter((e: any) => e.query.fallbackReason).map((e: any) => e.query.fallbackReason))];
for (const r of reasons) console.log(`  fell back: ${r}`);
process.exit(cloud.length === evidence.length ? 0 : 1);
