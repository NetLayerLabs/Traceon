// Checks the Meterless Nightshift connection and sends one real request on
// each route Traceon uses (fast, deep, vision). Run it before a demo: it also
// warms the local models. Usage: npm run nightshift:check
import fs from 'node:fs';
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
process.env.NEMOTRON_CACHE = 'off';
process.env.AI_PROVIDER = 'nightshift';
const savedKey = process.env.NVIDIA_API_KEY;
delete process.env.NVIDIA_API_KEY; // test Nightshift alone, with no fallback
const { nightshiftStatus, nemotronChat, NEMOTRON_FAST_MODEL, NEMOTRON_MODEL } = await import('../src/lib/nemotron.ts');

const st = await nightshiftStatus();
console.log(`Nightshift at ${st.url}: ${st.state}${st.standIn ? ' (STAND-IN, not the real runtime)' : ''}${st.routes.length ? ` (${st.routes.length} routes: ${st.routes.slice(0, 8).join(', ')})` : ''}`);
if (st.state === 'not configured') {
  console.log('Set NIGHTSHIFT_TOKEN (or NIGHTSHIFT_TOKEN_FILE pointing at the runtime\'s proxy-token file) in .env.local.');
  process.exit(1);
}
if (st.state !== 'online') {
  console.log(st.state === 'unauthorized' ? 'The token was rejected: copy it again from the runtime.' : 'Nightshift is not answering: is the app running with its hotspot on?');
  process.exit(1);
}
const photo = fs.readFileSync('public/samples/ntsb-787-li-ion-battery.jpg').toString('base64');
const calls = [
  { name: 'fast (planning, red team, Q&A)', opts: { model: NEMOTRON_FAST_MODEL, user: 'Reply with the single word: ready', maxTokens: 20, timeoutMs: 180_000 } },
  { name: 'deep (explanation)', opts: { model: NEMOTRON_MODEL, user: 'In one sentence, what is a confounder?', maxTokens: 120, timeoutMs: 180_000 } },
  { name: 'vision (defect photo)', opts: { model: NEMOTRON_MODEL, user: [{ type: 'text' as const, text: 'In one sentence, describe any visible damage.' }, { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${photo}` } }], maxTokens: 120, timeoutMs: 180_000 } },
];
let ok = true;
for (const c of calls) {
  const r = await nemotronChat(c.opts);
  if (!r.live && /cannot serve vision/.test(r.error ?? '')) {
    console.log(`NOTE  ${c.name}  Nightshift has no vision lane: the app sends the photo to Nemotron Super VL on NVIDIA NIM, labelled as the fallback`);
    continue;
  }
  ok &&= r.live && Boolean(r.text.trim());
  console.log(`${r.live && r.text.trim() ? 'PASS' : 'FAIL'}  ${c.name}  ${r.via ?? ''}  ${r.latencyMs} ms\n      ${(r.text || r.error || '').replace(/\s+/g, ' ').slice(0, 160)}`);
}
if (savedKey) console.log('\nNVIDIA NIM stays configured as the fallback for the app.');
process.exit(ok ? 0 : 1);
