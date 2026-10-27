// Regression tests for the Oct 27 audit, docs and landing copy: the README,
// ARCHITECTURE, the landing page and the checklists say what the code does,
// every command and link they name exists, and nothing internal ships in the
// public repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { collect, isolatedStorage, offline } from './helpers.mts';

isolatedStorage('fix-docs');
offline();
for (const k of ['NVIDIA_API_KEY', 'NIGHTSHIFT_TOKEN', 'NIGHTSHIFT_TOKEN_FILE', 'AI_PROVIDER', 'ZETARIS_API_URL', 'NEMOTRON_MODEL', 'NEMOTRON_FAST_MODEL', 'NIGHTSHIFT_VISION_MODEL', 'NIGHTSHIFT_FAST_MODEL', 'NIGHTSHIFT_DEEP_MODEL', 'NIGHTSHIFT_USE_NEMOTRON']) delete process.env[k];
process.env.NEMOTRON_CACHE = 'off';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const README = read('README.md');
const ARCH = read('ARCHITECTURE.md');
const LANDING = read('src/app/page.tsx');
// The Markdown a judge reads on GitHub, plus the files that carry instructions.
const MARKDOWN = ['README.md', 'ARCHITECTURE.md', 'DEMO_SCRIPT.md', 'TODO_BEFORE_SUBMISSION.md', 'examples/SUMMARY.md', 'vendor/README.md', ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
const PUBLIC_TEXT = [...MARKDOWN, '.env.example', 'sample.sh'];

const { runInvestigation } = await import('../src/lib/investigation.ts');
const { verifyLedger } = await import('../src/lib/actions.ts');
const ns = await import('../src/lib/nemotron.ts');

test('the README first screen has no raw placeholder and no stale private-repo note', () => {
  assert.doesNotMatch(README, /<VIDEO_URL>/);
  assert.match(README, /Demo video: link added with the submission/);
  assert.doesNotMatch(README, /private, access on request/);
});

test('figures on the landing page and in the README match the reference run', async () => {
  const ref = await collect((emit) => runInvestigation(emit, { scenarioId: 'reference', pacingMs: 0, vision: null }));
  const v = await verifyLedger(ref.one('done').evidence, 'reference');
  assert.equal(v.ok, true);
  const n = v.replayedQueries;
  assert.match(LANDING, new RegExp(`re-runs all ${n} queries`));
  assert.match(README, new RegExp(`replay of all ${n} SQL queries`));
  assert.match(README, new RegExp(`all ${n} queries on Zetaris`));
  for (const [name, text] of [['landing', LANDING], ['README', README], ['ARCHITECTURE', ARCH], ['TODO', read('TODO_BEFORE_SUBMISSION.md')]] as const)
    for (const m of text.matchAll(/(\d+) (?:SQL )?queries/g)) assert.equal(Number(m[1]), n, `${name}: "${m[0]}"`);
  // The gate's signature line on the landing page is the claim count, not the photo.
  const signature = ref.one('gate').criteria.find((c: { id: string }) => c.id === 'corroborate').detail as string;
  const claims = signature.match(/\d+\/\d+/)![0];
  assert.match(LANDING, new RegExp(`>${claims} claims<`));
  assert.doesNotMatch(LANDING, /photo \+ \d+\/\d+/);
});

test('the test counts in the README and ARCHITECTURE match the suites', () => {
  const testsIn = (f: string) => (read(`tests/${f}`).match(/^\s*(test|it)\(/gm) ?? []).length;
  const rows = [...ARCH.matchAll(/^\| `tests\/([a-z0-9-]+\.test\.mts)` \| (\d+) \|/gm)];
  assert.ok(rows.length >= 10, 'ARCHITECTURE section 13 lists the suites');
  for (const [, file, count] of rows) assert.equal(testsIn(file), Number(count), `${file}: ARCHITECTURE says ${count}`);
  const listed = rows.reduce((s, r) => s + Number(r[2]), 0);
  // README coverage line: its total is the sum of its per-suite counts.
  const coverage = README.match(/\*\*Test coverage\.\*\* (\d+) tests[^\n]*/);
  assert.ok(coverage, 'README coverage line');
  const perSuite = [...coverage[0].matchAll(/\((\d+)\)/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.equal(Number(coverage[1]), perSuite);
  assert.equal(perSuite, listed);
  // The pasted npm test summary: all passed, and no fewer tests than the suites listed.
  const total = Number(README.match(/^ℹ tests (\d+)$/m)?.[1]);
  assert.equal(Number(README.match(/^ℹ pass (\d+)$/m)?.[1]), total);
  assert.match(README, /^ℹ fail 0$/m);
  assert.ok(total >= listed, `README test status says ${total}, the suites hold ${listed}`);
});

test('the landing page says who writes the explanation on each route', () => {
  // On NIM (the hosted site) the explanation asks for NEMOTRON_MODEL, Super VL.
  assert.match(ns.NEMOTRON_MODEL, /super-vl/);
  // Through Nightshift, with Super VL held back, the deep job takes Ultra and the photo has no lane.
  const listed = ['nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3-ultra-550b-a55b'];
  assert.match(ns.pickNightshiftModel('deep', listed), /ultra/);
  assert.match(ns.pickNightshiftModel('fast', listed), /lightning/);
  assert.equal(ns.pickNightshiftModel('vision', listed), 'meterless/vision');
  assert.doesNotMatch(LANDING, /Ultra writes the explanation/);
  assert.match(LANDING, /written by Ultra through Nightshift on a Mac, and by Super VL on this site/);
  assert.match(LANDING, /the photo, and any call it cannot serve, goes to NVIDIA NIM/);
});

test('AI_PROVIDER is documented as it behaves: nim skips Nightshift, nightshift equals auto', () => {
  process.env.NIGHTSHIFT_TOKEN = 'ns-token';
  process.env.NVIDIA_API_KEY = 'nvapi-test';
  try {
    for (const mode of ['auto', 'nightshift']) {
      process.env.AI_PROVIDER = mode;
      assert.deepEqual(ns.aiProviders(), ['nightshift', 'nim'], mode);
    }
    process.env.AI_PROVIDER = 'nim';
    assert.deepEqual(ns.aiProviders(), ['nim']);
  } finally {
    for (const k of ['NIGHTSHIFT_TOKEN', 'NVIDIA_API_KEY', 'AI_PROVIDER']) delete process.env[k];
  }
  assert.doesNotMatch(ARCH, /forces one/);
  assert.match(ARCH, /`nightshift` currently behaves like `auto`/);
  assert.match(README, /`auto` or `nightshift` \(Nightshift first, labelled NIM fallback\), or `nim` \(NIM only\)/);
  assert.match(read('.env.example'), /nightshift currently behaves the same, and nim skips Nightshift/);
});

test('the system diagrams and the key table include Meterless Nightshift', () => {
  for (const [name, text] of [['README', README], ['ARCHITECTURE', ARCH]] as const) {
    const overview = text.match(/```mermaid\nflowchart LR\n {2}SRC[\s\S]*?```/)?.[0] ?? '';
    assert.match(overview, /--> NS\["Meterless Nightshift/, name);
    assert.match(overview, /\.-> NIM\["NVIDIA NIM/, name);
  }
  assert.match(README, /API -- "NIGHTSHIFT_TOKEN" --> NS/);
  assert.match(README, /^\| `NIGHTSHIFT_TOKEN` \(or the file in `NIGHTSHIFT_TOKEN_FILE`\) \| Server environment only \|/m);
});

test('the demo script has a Nightshift step, with labels the app really shows', () => {
  const demo = read('DEMO_SCRIPT.md');
  assert.match(demo, /npm run nightshift:check/);
  assert.match(demo, /\*\*Nightshift, 10 s\*\*/);
  const lightning = { provider: 'nightshift' as const, model: 'nvidia/nemotron-3.5-lightning-30b-a3b' };
  assert.ok(demo.includes(`${ns.aiName(lightning)} ranked 7 hypotheses`), 'the trace line');
  assert.ok(demo.includes(ns.aiVia(lightning).split(' · ')[0]), 'the provider tag');
  // The chip reads "Nightshift <state>" with the states nightshiftStatus() returns.
  assert.match(read('src/app/app/page.tsx'), /Nightshift \{status\.ai\.nightshift\.standIn \? 'stand-in' : status\.ai\.nightshift\.state\}/);
  assert.match(demo, /\*Nightshift online\*/);
  assert.match(demo, /\*Nightshift offline\*/);
});

test('ARCHITECTURE and the Zetaris guide describe Zetaris as it runs', () => {
  assert.doesNotMatch(ARCH, /not yet run against a live cluster/);
  assert.match(ARCH, /Zetaris holds the reference scenario only/);
  // The docs quote the chip as the app renders it.
  assert.match(read('src/app/app/page.tsx'), /'parity ok'/);
  for (const f of ['ARCHITECTURE.md', 'docs/ZETARIS_SETUP.md', 'TODO_BEFORE_SUBMISSION.md']) assert.doesNotMatch(read(f), /parity ✓/, f);
});

test('every npm script the docs name exists', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const f of PUBLIC_TEXT) for (const m of read(f).matchAll(/npm run ([a-z][\w:-]*)/g)) assert.ok(scripts[m[1]], `${f}: npm run ${m[1]} is not a script`);
});

test('relative links in the docs point at files in the repo', () => {
  for (const f of MARKDOWN) {
    for (const m of read(f).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(f), target)), `${f}: broken link ${m[1]}`);
    }
  }
});

test('every Markdown table row has as many cells as its header', () => {
  const cells = (row: string) => row.replace(/\\\|/g, '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
  for (const f of MARKDOWN) {
    const lines = read(f).split('\n');
    let fenced = false;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('```')) fenced = !fenced;
      if (fenced || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(lines[i].trim())) continue;
      const width = cells(lines[i - 1]);
      for (let j = i + 1; j < lines.length && lines[j].trim().startsWith('|'); j++) assert.equal(cells(lines[j]), width, `${f}:${j + 1} has ${cells(lines[j])} cells, the header ${width}`);
    }
  }
});

test('no internal operations notes ship in the public docs', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'docs/plan')), false, 'docs/plan is internal');
  for (const f of PUBLIC_TEXT) {
    const text = read(f);
    for (const ip of text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) assert.ok(ip === '127.0.0.1' || ip === '0.0.0.0', `${f}: ${ip}`);
    assert.doesNotMatch(text, /\/opt\/|\/Users\/|\bis a judge\b|\bCTO\b|Judge #|General Chat/, f);
  }
});

test('every environment variable the code reads is in the README and .env.example', () => {
  const vars = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(e.name)) for (const m of read(p).matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g)) vars.add(m[1] ?? m[2]);
    }
  };
  walk('src');
  walk('scripts');
  // Test doubles, the build directory and the hosting platform are not settings.
  const internal = /^(MOCK_|NEXT_)|^(VERCEL|NODE_ENV|PORT)$/;
  const example = read('.env.example');
  for (const v of [...vars].filter((x) => !internal.test(x))) {
    assert.ok(new RegExp(`\\b${v}\\b`).test(README), `README does not document ${v}`);
    assert.ok(new RegExp(`\\b${v}\\b`).test(example), `.env.example does not list ${v}`);
  }
  // Copied as is, a set deadline would override the 25 s vision default, and an empty one means 0 ms.
  assert.doesNotMatch(example, /^NEMOTRON_THINKING_DEADLINE_MS=/m);
  assert.doesNotMatch(example, /^RUN_TIMEOUT_MS=\s*$/m);
});

test('shell scripts keep LF line endings on any checkout', () => {
  const attrs = read('.gitattributes');
  assert.match(attrs, /^\*\.sh text eol=lf$/m);
  assert.match(attrs, /^video export-ignore$/m);
  assert.doesNotMatch(read('sample.sh'), /\r/);
});

test('sample.sh accepts exactly the Node versions Next.js supports', () => {
  assert.equal(JSON.parse(read('node_modules/next/package.json')).engines.node, '^18.18.0 || ^19.8.0 || >= 20.0.0');
  const check = read('sample.sh').match(/node -e '([^']+)'/)?.[1];
  assert.ok(check, 'the version check in sample.sh');
  const accepts = (version: string) => {
    let code = -1;
    vm.runInNewContext(check, { process: { versions: { node: version }, exit: (c: number) => (code = c) } });
    return code === 0;
  };
  for (const v of ['16.20.2', '18.0.0', '18.17.1', '19.7.0']) assert.equal(accepts(v), false, v);
  for (const v of ['18.18.0', '18.20.4', '19.8.0', '20.0.0', '22.11.0', '26.5.0']) assert.equal(accepts(v), true, v);
});

test('npm test and the local servers work as the README says', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  // A quoted glob needs the test runner's own glob support (Node 21+); the shell expands this one.
  assert.doesNotMatch(scripts.test, /'/);
  assert.match(scripts.test, / tests\/\*\.test\.mts$/);
  for (const e of fs.readdirSync(path.join(ROOT, 'tests'), { withFileTypes: true }))
    if (e.isDirectory()) assert.equal(fs.readdirSync(path.join(ROOT, 'tests', e.name)).some((n) => n.endsWith('.test.mts')), false, `tests/${e.name} holds suites the glob misses`);
  // The no-login app is reachable only from this machine.
  assert.match(scripts.dev, /-H 127\.0\.0\.1/);
  assert.match(read('sample.sh'), /next start -H 127\.0\.0\.1/);
});

test('the vendored Apache-2.0 engines ship the licence text', () => {
  for (const d of ['meterless-hmem', 'meterless-markovian']) {
    const text = read(`vendor/${d}/LICENSE`);
    assert.match(text, /Apache License\s+Version 2\.0, January 2004/, d);
    assert.match(text, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/, d);
  }
});

test('responses carry no X-Powered-By banner', async () => {
  const config = (await import('../next.config.mjs')).default;
  assert.equal(config.poweredByHeader, false);
});

test('the committed sample summary points at files next to it', () => {
  const summary = read('examples/SUMMARY.md');
  assert.doesNotMatch(summary, /sample-output\//);
  for (const f of ['proof-bundle.json', 'verify.json', 'explanation.txt', '8d-report.html', 'supplier-claim.html']) assert.ok(fs.existsSync(path.join(ROOT, 'examples/reference', f)), f);
  // The generator writes the same relative wording, so a regenerated summary stays right.
  for (const line of read('scripts/sample.mts').split('\n').filter((l) => /\bsay\(/.test(l))) assert.doesNotMatch(line, /sample-output\//, line.trim());
});

test('the landing page and README agree on duration, samples and context feeds', () => {
  assert.match(LANDING, /Under a minute on 180,000 units/);
  assert.match(README, /full investigation in under a minute/);
  assert.doesNotMatch(LANDING + README, /about 30 seconds/i);
  // The bundled real sample: one row per drive under a header.
  const drives = read('public/samples/backblaze-drives-q2-2026.csv').trimEnd().split('\n').length - 1;
  const n = drives.toLocaleString('en-US');
  assert.match(LANDING, new RegExp(`${n} real Backblaze hard drives`));
  assert.match(README, new RegExp(`${n} real Backblaze drives`));
  // Federal feeds are context, never a statistic; the first model guess is not always the heat.
  assert.doesNotMatch(LANDING, /Base rates for/);
  assert.doesNotMatch(LANDING, /first guess was heat/);
  assert.doesNotMatch(README, /sac2's own excess disappears/);
});
