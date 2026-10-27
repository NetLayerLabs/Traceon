// Regressions for the data fixes from the Oct 27 audit: a feed that fails, or
// answers with an error, is never shown as live; uploads cannot lock /data;
// the CSV parser keeps every row; the /data Backblaze preset is README
// Example 3; the live NHTSA replay says what NHTSA had nothing for; reset is
// off on a shared server. Offline: every request is answered by a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect, isolatedStorage } from './helpers.mts';

const storage = isolatedStorage('fix-data');
for (const k of Object.keys(process.env)) if (/^(NVIDIA_|NEMOTRON_|NIGHTSHIFT_|ZETARIS_|BRIGHTDATA_|OPENFDA_|AI_PROVIDER|TRACEON_)/.test(k)) delete process.env[k];
process.env.NEMOTRON_CACHE = 'off';

// Every request goes to `answer`, which each test sets with stub(); `calls` records them.
type Answer = (url: string, init?: RequestInit) => Response | Promise<Response>;
let answer: Answer = () => {
  throw new Error('network disabled in tests');
};
let calls: { url: string; init?: RequestInit }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init });
  return answer(String(input), init);
}) as typeof fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const { fetchAllFeeds, fetchBrightDataNews, fetchCpscEbikeRecalls, fetchNhtsaBatteryFires, fetchOpenFdaBatteryEvents, fetchWarrantyClaims, isBatteryFire, resetFeedCache } = await import('../src/lib/signals.ts');
const { LIMITS, SAMPLE_IDS, buildCustomMesh, getDataset, listDatasets, parseCsv, saveDataset, validateMapping } = await import('../src/lib/datasets.ts');
const { resolveScenario } = await import('../src/lib/enterpriseData.ts');
const { analyze, liveSnapshot } = await import('../src/lib/realRecall.ts');
const { resetEnabled } = await import('../src/lib/meterless.ts');
const { WATCH_MIN_FAILURES, watchReplay } = await import('../src/lib/watch.ts');
const { runInvestigation } = await import('../src/lib/investigation.ts');
const datasetsRoute = await import('../src/app/api/datasets/route.ts');
const backtestRoute = await import('../src/app/api/backtest/route.ts');
const resetRoute = await import('../src/app/api/reset/route.ts');

const stub = (fn: Answer) => {
  answer = fn;
  calls = [];
  resetFeedCache();
};

test('CPSC: an error answered with HTTP 200 is unreachable, not a recall, and is not kept', async () => {
  stub(() => json([{ RecallNumber: null, RecallDate: null, Title: 'Error retrieving Recalls: The underlying provider failed on Open.', Hazards: [] }]));
  const bad = await fetchCpscEbikeRecalls();
  assert.equal(bad.status, 'unreachable');
  assert.deepEqual(bad.items, []);
  assert.match(bad.note, /error: Error retrieving Recalls/);
  answer = () => json([{ RecallNumber: '26236', RecallDate: '2026-01-29T00:00:00', Title: 'E-bike batteries recalled due to fire hazard', Hazards: [{ Name: 'Fire' }], URL: 'https://www.cpsc.gov/x' }]);
  const good = await fetchCpscEbikeRecalls();
  assert.equal(good.status, 'live');
  assert.deepEqual(good.items.map((i) => [i.id, i.date]), [['CPSC-26236', '2026-01-29']]);
  assert.equal(calls.length, 2, 'the error was retried, not served again');
  await fetchCpscEbikeRecalls();
  assert.equal(calls.length, 2, 'a live answer is kept for 10 minutes');
  assert.equal(calls[0].init?.cache, 'no-store', 'never through Next’s fetch cache');
  stub(() => json([]));
  assert.equal((await fetchCpscEbikeRecalls()).note, '0 e-bike recalls since 2025-01-01, 0 citing fire/burn hazard', 'no recalls is still a live answer');
});

// Real openFDA narratives (public MAUDE reports), trimmed.
const TEST_CRITERIA =
  'BASED ON IEC62133, WHEN OUR COMPANY SELECTS LITHIUM BATTERIES, WE CONDUCT EIGHT TESTS ON THEM. THE PASS CRITERIA FOR THESE EIGHT TESTS ARE THAT AFTER TESTING, THE BATTERY SHOULD NOT SMOKE, CATCH FIRE, LEAK FLUID, OR EXPLODE. NEEDLE PUNCTURE SIMULATION: NO OCCURRENCE OF SMOKING.';
const RUNAWAY =
  'NAVIO MIDI AND NAVIO MAXI ARE SPEECH-GENERATING AAC MEDICAL DEVICES POWERED BY AN INTERNAL LITHIUM-ION POUCH BATTERY. DURING REPAIR INTAKE ON A DEVICE RETURNED ON FEBRUARY 10TH FOR UNRELATED FUNCTIONAL ISSUES, FRACTURE OF INTERNAL BATTERY MOUNTING TABS WAS IDENTIFIED WITH EVIDENCE OF PRIOR DROP OR IMPACT DAMAGE. THE FRACTURED INTERNAL HOUSING CONTACTED AND COMPROMISED THE PRISMATIC LITHIUM-ION BATTERY CASING, LEADING TO AN INTERNAL SHORT CIRCUIT AND LOCALIZED THERMAL EVENT WITH INTERNAL HEATING AND BATTERY GAS VENTING; NO THERMAL EFFECTS EXTENDED BEYOND INTERNAL COMPONENTS. THE EXTERNAL ENCLOSURE REMAINED INTACT, AND NO SUSTAINED FIRE OR EXPLOSION OCCURRED. PREVIOUSLY FIVE CASES INVOLVED FRACTURED MOUNTING TABS ONLY, WITHOUT BATTERY POUCH DAMAGE, INTERNAL SHORT, THERMAL EFFECTS, HEAT, SMOKE, OR USER EXPOSURE. THOSE CASES WERE INITIALLY ASSESSED AS NON-REPORTABLE QUALITY FINDINGS BECAUSE NO BATTERY COMPROMISE, NO HAZARDOUS SITUATION, AND NO INJURY OR POTENTIAL FOR INJURY WERE IDENTIFIED AT THE TIME. THE SIXTH CASE INVOLVING LOCALIZED THERMAL RUNAWAY TRIGGERED ESCALATION AND REPORTABILITY ASSESSMENT.';

test('openFDA: negated test criteria are not an event, the snippet shows the event, and the reply is kept in process', async () => {
  const report = (n: string, text: string) => ({ report_number: n, date_received: '20261020', device: [{ generic_name: 'Device' }], mdr_text: [{ text }] });
  stub(() => json({ results: [report('3014166838-2026-00003', TEST_CRITERIA), report('3004959902-2026-00001', RUNAWAY)] }));
  const f = await fetchOpenFdaBatteryEvents();
  assert.equal(f.status, 'live');
  assert.deepEqual(f.items.map((i) => i.id), ['MDR-3004959902-2026-00001']);
  assert.match(f.items[0].detail, /LOCALIZED THERMAL RUNAWAY/);
  assert.match(f.note, /^1 of the latest 2 reports/);
  assert.equal(calls[0].init?.cache, 'no-store', 'the 2.5 MB reply never goes to Next’s fetch cache');
  await fetchOpenFdaBatteryEvents();
  assert.equal(calls.length, 1, 'kept for 10 minutes');
  stub(() => new Response('rate limited', { status: 429 }));
  assert.equal((await fetchOpenFdaBatteryEvents()).status, 'unreachable');
  await fetchOpenFdaBatteryEvents();
  assert.equal(calls.length, 2, 'a failure is retried on the next call');
});

test('NHTSA radar: a complaint about the recall is not a fire; a battery fire with no "pack" or "cell" is', async () => {
  // Real Bolt EV complaints: ODI-11426342 (recall only, NHTSA fire flag set), ODI-11425524 and ODI-11372429 (fires).
  assert.equal(
    isBatteryFire({ fire: true, crash: false, components: 'ELECTRICAL SYSTEM,FUEL/PROPULSION SYSTEM', summary: 'I currently lease a 2019 Chevrolet Bolt which is part of the recall announced today by GM. This software was supposed to identify defective batteries but it has not been successful as evidenced by the mounting number of fires that have happened after the fix. GM stated that they will again be using software to identify defective cells.' }),
    false
  );
  assert.equal(isBatteryFire({ fire: true, crash: false, components: 'ELECTRICAL SYSTEM', summary: 'The car battery lit on fire and the car burned.' }), true);
  assert.equal(isBatteryFire({ fire: true, crash: false, components: 'ELECTRICAL SYSTEM', summary: 'WE FOUND THAT THE CHEVY BOLT WAS ON FIRE AND THERE WAS LOT OF SMOKE IN THE GARAGE. THE CHEVY BOLT WAS KEPT FOR CHARGING OVERNIGHT.' }), true);
  // A query NHTSA did not answer is reported and asked again next time.
  stub((url) => (url.includes('modelYear=2017') ? new Response('busy', { status: 503 }) : json({ results: [] })));
  assert.match((await fetchNhtsaBatteryFires()).note, /1 of 5 queries unanswered/);
  await fetchNhtsaBatteryFires();
  assert.equal(calls.length, 10, 'a partial answer is not kept');
});

test('Bright Data: a timeout is named, kept for 5 minutes, and loads that arrive together share one request', async () => {
  process.env.BRIGHTDATA_API_TOKEN = 'test-token';
  try {
    stub(async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    const [a, b] = await Promise.all([fetchBrightDataNews(), fetchBrightDataNews()]);
    assert.equal(calls.length, 1);
    assert.equal(a, b);
    assert.equal(a?.status, 'unreachable');
    assert.match(a!.note, /^Bright Data did not answer within 9 s; next try in 5 minutes$/);
    await fetchBrightDataNews();
    assert.equal(calls.length, 1, 'no new request while the failure is kept');
    stub(() => new Response('denied', { status: 401 }));
    assert.match((await fetchBrightDataNews())!.note, /answered HTTP 401/);
    const xml = '<rss><channel><item><title>E-bike battery fire closes street - Local News</title><link>https://news.google.com/x</link><pubDate>Thu, 22 Oct 2026 07:00:00 GMT</pubDate><source url="https://x">Local News</source></item></channel></rss>';
    stub(() => new Response(xml));
    assert.equal((await fetchBrightDataNews())?.status, 'live');
    await fetchBrightDataNews();
    assert.equal(calls.length, 1, 'news is kept for 30 minutes');
  } finally {
    delete process.env.BRIGHTDATA_API_TOKEN;
  }
});

test('sample mode (TRACEON_OFFLINE=1): every feed reports unreachable, exactly as offline, without a request', async () => {
  process.env.TRACEON_OFFLINE = '1';
  process.env.BRIGHTDATA_API_TOKEN = 'test-token';
  try {
    stub(() => json([]));
    const feeds = await fetchAllFeeds('reference');
    assert.equal(calls.length, 0);
    const federal = feeds.filter((f) => ['CPSC SaferProducts', 'openFDA MAUDE', 'NHTSA ODI'].includes(f.feed));
    assert.deepEqual(federal.map((f) => `${f.status}: ${f.note}`), Array(3).fill('unreachable: Feed did not respond'), 'the same ledger lines as the committed examples');
    assert.ok(!feeds.some((f) => f.feed.startsWith('Bright Data')));
  } finally {
    delete process.env.TRACEON_OFFLINE;
    delete process.env.BRIGHTDATA_API_TOKEN;
  }
});

test('warranty claims: each tag appears once', () => {
  for (const i of fetchWarrantyClaims('reference').items) assert.equal(new Set(i.tags).size, i.tags.length, i.id);
});

test('CSV: a quote inside a field is a character, and an unclosed quote is an error with its line', () => {
  assert.deepEqual(parseCsv('a,b\n1,cracked 5" display\n2,y\n'), [['a', 'b'], ['1', 'cracked 5" display'], ['2', 'y']]);
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n3,"two\nlines"'), [['a', 'b'], ['x, y', 'say "hi"'], ['3', 'two\nlines']]);
  assert.throws(() => parseCsv('a,b\n1,"x\n2,y\n3,z\n'), /^Error: Unclosed quote starting on line 2$/);
  const rows = Array.from({ length: 300 }, (_, i) => `U${i},S${i % 3},${i % 5 ? 'no' : 'yes'},${i === 174 ? 'cracked 5" display' : 'no power'}`);
  assert.equal(parseCsv(['serial,supplier,failed,symptom', ...rows].join('\n')).length, 301, 'no row is folded into another');
});

test('upload route: an unclosed quote is a 400, and a third upload while two are being read gets 429', async () => {
  const post = (body: BodyInit) => datasetsRoute.POST(new Request('http://test/api/datasets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit));
  const bad = await post(JSON.stringify({ csv: 'a,b\n1,"x\n2,y\n' }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Unclosed quote starting on line 2');
  // Two uploads whose bodies are still arriving hold both slots.
  const finish: (() => void)[] = [];
  const slow = () =>
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"csv":"a,b\\n1,2\\n"'));
        finish.push(() => (c.enqueue(new TextEncoder().encode('}')), c.close()));
      },
    });
  const first = post(slow());
  const second = post(slow());
  const third = await post(JSON.stringify({ csv: 'a,b\n1,2\n' }));
  assert.equal(third.status, 429);
  assert.equal(third.headers.get('retry-after'), '5');
  finish.forEach((f) => f());
  assert.deepEqual([(await first).status, (await second).status], [200, 200]);
  assert.equal((await post(JSON.stringify({ csv: 'a,b\n1,2\n' }))).status, 200, 'the slots are released');
});

test('uploads: at the cap the oldest upload makes room; the bundled samples and a running case stay', async () => {
  process.env.METERLESS_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'traceon-fix-data-cap-'));
  try {
    const table = parseCsv(fs.readFileSync('public/samples/charger-returns.csv', 'utf-8'));
    // Exactly what the /data page sends for the charger sample.
    const charger = { outcome: 'returned', failValues: ['yes'], factors: ['resin_lot', 'mold_cavity', 'shift', 'line', 'region'], unitCost: 25, serial: 'serial', date: 'failure_date', symptom: 'symptom', daysInField: 'days_in_field' };
    const sample = saveDataset('charger-returns', table[0], table.slice(1), charger);
    assert.ok(SAMPLE_IDS.has(sample.id), `the charger preset is ${sample.id}`);
    const cols = ['serial', 'lot', 'line', 'failed'];
    const rows = Array.from({ length: 40 }, (_, i) => [`S${i}`, i % 2 ? 'A' : 'B', `L${i % 3}`, i < 6 ? 'yes' : 'no']);
    const upload = async (unitCost: number, keep: string[] = []) => {
      await new Promise((r) => setTimeout(r, 3)); // distinct creation times
      return saveDataset(`upload ${unitCost}`, cols, rows, { outcome: 'failed', failValues: ['yes'], factors: ['lot', 'line'], unitCost }, keep).id;
    };
    const ids: string[] = [];
    while (listDatasets().length < LIMITS.maxDatasets) ids.push(await upload(ids.length + 1));
    const extra = await upload(1000);
    assert.equal(listDatasets().length, LIMITS.maxDatasets, 'never more than the cap');
    assert.equal(getDataset(ids[0]), null, 'the oldest upload made room');
    assert.ok(getDataset(sample.id), 'the sample stays, though it is older');
    assert.ok(getDataset(extra));
    await upload(1001, [ids[1]]);
    assert.ok(getDataset(ids[1]), 'a dataset being investigated stays');
    assert.equal(getDataset(ids[2]), null);
  } finally {
    process.env.METERLESS_STORAGE_DIR = storage;
  }
});

test('uploads: failure dates that are not YYYY-MM-DD are refused at upload, at the same 80% bar the replay uses', () => {
  const cols = ['serial', 'lot', 'line', 'failed', 'failure_date'];
  const make = (date: (i: number) => string) => Array.from({ length: 60 }, (_, i) => [`S${i}`, i % 2 ? 'A' : 'B', `L${i % 3}`, i < 10 ? 'yes' : 'no', i < 10 ? date(i) : '']);
  const m = { outcome: 'failed', failValues: ['yes'], factors: ['lot', 'line'], serial: 'serial', date: 'failure_date' };
  assert.equal(validateMapping(cols, make(() => '05/22/2026'), m), 'Failure date: 10 of 10 failures have no YYYY-MM-DD date (for example "05/22/2026"); convert them, or set the date column to none');
  const some = (valid: number) => make((i) => (i < valid ? `2026-05-0${i + 1}` : '2026-02-30'));
  assert.equal(validateMapping(cols, some(8), m), null);
  assert.match(validateMapping(cols, some(7), m)!, /^Failure date: 3 of 10 failures/);
  const ds = saveDataset('dates', cols, some(8), m);
  assert.equal(buildCustomMesh(ds, resolveScenario(ds.id)).capabilities.dates, true, 'what is accepted is used');
});

test('the /data Backblaze preset is README Example 3: same suspects, never evicted, same result', async () => {
  const page = fs.readFileSync('src/app/data/page.tsx', 'utf-8');
  const preset = page.slice(page.indexOf("id: 'backblaze'"), page.indexOf("id: 'charger'"));
  assert.match(preset, /factors: \['model', 'datacenter', 'age_band'\]/);
  const table = parseCsv(fs.readFileSync('public/samples/backblaze-drives-q2-2026.csv', 'utf-8'));
  // What "Use it" then "Open the case file" sends (the empty symptom is dropped).
  const mapping = { outcome: 'failed', failValues: ['yes'], factors: ['model', 'datacenter', 'age_band'], unitCost: 25, serial: 'serial', date: 'failure_date', daysInField: 'days_in_field' };
  assert.equal(validateMapping(table[0], table.slice(1), mapping), null);
  const ds = saveDataset('backblaze-drives-q2-2026', table[0], table.slice(1), mapping);
  assert.ok(SAMPLE_IDS.has(ds.id), `the Backblaze preset is ${ds.id}`);
  const r = await collect((emit) => runInvestigation(emit, { scenarioId: ds.id, pacingMs: 0, vision: null }));
  const nodes = new Map(r.of('hypothesis').map((e) => [e.node.id, e.node]));
  assert.equal(nodes.get('H-MODEL').hotGroup, 'HGST HUH721212ALN604');
  assert.notEqual(nodes.get('H-MODEL').status, 'CONFIRMED');
  assert.notEqual(nodes.get('H-DATACENTER').status, 'CONFIRMED');
  assert.equal(r.one('gate').pass, false);
});

test('live NHTSA replay: model years NHTSA has nothing for are listed, an unknown vehicle is a 422, no answer is a 502', async () => {
  const complaint = (n: number, date: string, fire = false) => ({ odiNumber: n, dateComplaintFiled: date, fire, components: 'ELECTRICAL SYSTEM', summary: 'x' });
  let inFlight = 0;
  let peak = 0;
  stub(async (url) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    const q = new URL(url).searchParams;
    const [make, model, year] = [q.get('make'), q.get('model'), Number(q.get('modelYear'))];
    if (make === 'BROKEN') return new Response('unavailable', { status: 503 });
    if (make === 'NOTAMAKE' || (model === 'MODEL Y' && year > 2020) || (model === 'F-150' && year > 2020)) return json({ count: 0, results: [] }, 400);
    if (url.includes('recalls')) return json({ results: [] });
    return json({ results: [complaint(year * 1000 + String(model).length, '03/01/2021', true), complaint(year * 1000 + 500 + String(model).length, '04/01/2021')] });
  });
  const snap = await liveSnapshot('TESLA', 'MODEL Y', [2020, 2021, 2022]);
  assert.deepEqual(snap.missingYears, [2021, 2022]);
  assert.deepEqual(snap.years, [2020]);
  assert.deepEqual(snap.comparatorGaps, ['FORD F-150 2021', 'FORD F-150 2022']);
  assert.equal(snap.source, 'api.nhtsa.gov (live); no complaints under this name for 2021, 2022; comparators missing: FORD F-150 2021, FORD F-150 2022');
  assert.deepEqual(analyze(snap).missingYears, [2021, 2022]);
  assert.ok(peak > 1 && peak <= 4, `four lookups at a time (peak ${peak})`);
  const cache = path.join(storage, 'nhtsa');
  assert.ok(fs.existsSync(path.join(cache, 'c-TESLA-MODEL_Y-2020.json')));
  assert.ok(!fs.existsSync(path.join(cache, 'c-TESLA-MODEL_Y-2021.json')), 'an empty answer is not cached');
  const post = (body: unknown) => backtestRoute.POST(new Request('http://test/api/backtest', { method: 'POST', body: JSON.stringify(body) }));
  const unknown = await post({ make: 'NOTAMAKE', model: 'NOPE', years: [2020] });
  assert.equal(unknown.status, 422);
  assert.match((await unknown.json()).error, /^NHTSA has no complaints for NOTAMAKE NOPE in 2020\./);
  const down = await post({ make: 'BROKEN', model: 'CAR', years: [2020] });
  assert.equal(down.status, 502);
  assert.match((await down.json()).error, /no answer from api\.nhtsa\.gov for BROKEN CAR \(2020 complaints, 2020 recalls\)/);
  process.env.TRACEON_OFFLINE = '1';
  try {
    calls = [];
    await assert.rejects(liveSnapshot('TESLA', 'MODEL Y', [2020]), /off in sample mode/);
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.TRACEON_OFFLINE;
  }
});

test('reset: off on a production server unless TRACEON_ENABLE_RESET=1; TRACEON_DISABLE_RESET=1 always wins', async () => {
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  try {
    env.NODE_ENV = 'production';
    assert.equal(resetEnabled(), false);
    const res = await resetRoute.POST();
    assert.equal(res.status, 403);
    env.TRACEON_ENABLE_RESET = '1';
    assert.equal(resetEnabled(), true);
    env.TRACEON_DISABLE_RESET = '1';
    assert.equal(resetEnabled(), false);
    env.NODE_ENV = 'development';
    delete env.TRACEON_ENABLE_RESET;
    assert.equal(resetEnabled(), false);
    delete env.TRACEON_DISABLE_RESET;
    assert.equal(resetEnabled(), true, 'next dev keeps the Reset demo button working');
  } finally {
    if (nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = nodeEnv;
    delete env.TRACEON_ENABLE_RESET;
    delete env.TRACEON_DISABLE_RESET;
  }
});

test('watch: the alert says how many failures its group had, at least the minimum it waits for', () => {
  const w = watchReplay('reference');
  const day = w.days.find((d) => d.date === w.alert!.date)!;
  assert.equal(w.alert!.failures, day.top!.failures);
  assert.ok(w.alert!.failures >= WATCH_MIN_FAILURES);
  assert.ok(w.alert!.claims >= w.alert!.failures);
});
