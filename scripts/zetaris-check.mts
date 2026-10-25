// Verifies the Zetaris connection against the live API and checks that the
// cloud holds exactly the data the demo reasons over (hash parity with the
// local mirror). Usage: npm run zetaris:check  (reads .env.local)
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { zetarisParityCheck, zetarisMode } = await import('../src/lib/zetaris.ts');
console.log('mode:', zetarisMode(), process.env.ZETARIS_API_URL ?? '');
const r = await zetarisParityCheck();
if (!r.configured) {
  console.log('Not configured. Set ZETARIS_API_URL, ZETARIS_ORG_ID and ZETARIS_API_TOKEN (or ZETARIS_USERNAME/ZETARIS_PASSWORD) in .env.local.');
  process.exit(1);
}
for (const p of r.probes) console.log(`${p.ok ? 'PASS' : 'FAIL'}  ${p.ms}ms  ${p.sql}${'error' in p && p.error ? `\n      ${p.error}` : `  (cloud ${p.cloudRows} rows / mirror ${p.localRows})`}`);
console.log(r.ok ? '\nZetaris parity OK: cloud data matches the demo mesh.' : '\nParity FAILED (see above).');
process.exit(r.ok ? 0 : 1);
