// Records the real Traceon app for the film, and writes the figures of the recorded runs to
// data/live.json (never typed by hand).
//   ONLY=run_live,proof_live node scripts/capture.mjs        the production site (Zetaris live)
//   ONLY=nightshift_local,act_local node scripts/capture.mjs   this Mac (Nightshift as AI provider)
// Output: .cache/frames/<clip>/ (JPEG screencast + frames.json), .cache/marks.json (event times),
// .cache/meta.json (per clip: element rects in CSS px). scripts/encode.mjs makes the clips.
//
// 1600x900 CSS px at device scale 2. Writes are kept to the minimum and listed here:
//   production: one investigation run (normal use), one exhibit opened, one "Replay & verify";
//   this Mac only: one investigation run and one quarantine approval by "VP Quality" (the
//   app's own placeholder role), on a local server with its own storage. No approval ever
//   touches the production site.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const LIVE = process.env.LIVE || "https://traceon.netlayerlabs.com";
const LOCAL = process.env.LOCAL || "http://127.0.0.1:3821";
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const FRAMES = join(ROOT, ".cache/frames");
const SCALE = 2;
const VIEW = { w: 1600, h: 900 };
const ONLY = process.env.ONLY?.split(",");
if (!ONLY) { console.error("Set ONLY=<clip,...>: run_live,proof_live (production) or nightshift_local,act_local (this Mac)."); process.exit(1); }
const want = (clip) => ONLY.includes(clip);
mkdirSync(FRAMES, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(0)}s`, ...a);
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
const marks = readJson(join(ROOT, ".cache/marks.json"));
const meta = readJson(join(ROOT, ".cache/meta.json"));
const liveFile = join(ROOT, "data/live.json");
const liveData = readJson(liveFile);
const mark = (k) => { marks[k] = Date.now() / 1000; log("mark", k); };
const save = () => {
  writeFileSync(join(ROOT, ".cache/marks.json"), JSON.stringify(marks, null, 1));
  writeFileSync(join(ROOT, ".cache/meta.json"), JSON.stringify(meta, null, 1));
  writeFileSync(liveFile, JSON.stringify(liveData, null, 1) + "\n");
};

// A visible pointer (headless Chrome draws none), a click ring and an eased scroll helper.
const OVERLAY = `(() => {
  window.__ease = (el, prop, to, ms) => new Promise((done) => {
    const from = el[prop]; const start = performance.now();
    const f = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => { const p = Math.min(1, (now - start) / ms); el[prop] = from + (to - from) * f(p); if (p < 1) requestAnimationFrame(step); else done(el[prop]); };
    requestAnimationFrame(step);
  });
  if (document.getElementById('__cur')) return;
  const s = document.createElement('style');
  s.textContent = '#__cur{position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(250,248,243,.96);box-shadow:0 0 0 2px rgba(194,61,23,.85),0 4px 14px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .3s ease,transform .12s ease-out,left .8s cubic-bezier(.22,1,.36,1),top .8s cubic-bezier(.22,1,.36,1)}#__cur.down{transform:scale(.7)}.__ring{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:2px solid rgba(194,61,23,.85);z-index:2147483646;pointer-events:none;animation:__r .6s ease-out forwards}@keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}';
  document.head.appendChild(s);
  const c = document.createElement('div'); c.id = '__cur'; document.body.appendChild(c);
})()`;

let b;
const js = (e) => b.js(e);
async function glide(x, y, settle = 900) {
  await js(`(() => { const k = document.getElementById('__cur'); if (k) { k.style.opacity = '1'; k.style.left = '${x}px'; k.style.top = '${y}px'; } })()`);
  await sleep(820);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(Math.max(0, settle - 820));
}
async function clickAt(x, y) {
  await js(`(() => { const k = document.getElementById('__cur'); k?.classList.add('down'); const r = document.createElement('div'); r.className = '__ring'; r.style.left = '${x}px'; r.style.top = '${y}px'; document.body.appendChild(r); setTimeout(() => { k?.classList.remove('down'); r.remove(); }, 650); })()`);
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(90);
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}
const centerOf = (finder) => js(`(() => { const e = ${finder}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const rectOf = async (finder) => { const r = await b.rectOf(finder); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
const parkMouse = () => b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: VIEW.w - 4, y: VIEW.h - 4 });
async function press(finder, settle = 700) {
  const p = await centerOf(finder);
  if (!p) throw new Error("press: not found " + finder.slice(0, 90));
  await glide(p.x, p.y, 1000);
  await clickAt(p.x, p.y);
  await sleep(settle);
  return p;
}
async function typeText(text, cps = 14) {
  for (const ch of text) { await b.send("Input.insertText", { text: ch }); await sleep(1000 / cps + Math.random() * 30); }
}
const byText = (sel, text, scope = "document") => `[...${scope}.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(text)}))`;
const card = (title) => `[...document.querySelectorAll('.card')].find((e) => e.textContent.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(title)}))`;
const LEFT = `document.querySelector('.panes > .pane')`;
const CENTER = `document.querySelector('main.pane')`;
const RIGHT = `document.querySelector('.pane.right')`;
async function waitFor(cond, ms = 30000, what = cond) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await js(`!!(${cond})`).catch(() => false)) return true; await sleep(300); }
  throw new Error("timed out waiting for " + String(what).slice(0, 120));
}
/** Eases a pane so the card's top sits `pad` px below the pane's top. */
async function scrollPaneTo(pane, finder, ms = 1800, pad = 70) {
  const y = await js(`(() => { const p = ${pane}, e = ${finder}; if (!p || !e) return null; return Math.max(0, Math.round(p.scrollTop + e.getBoundingClientRect().top - p.getBoundingClientRect().top - ${pad})); })()`);
  if (y == null) throw new Error("scrollPaneTo: not found " + finder.slice(0, 80));
  await js(`window.__ease(${pane}, 'scrollTop', ${y}, ${ms})`);
  await sleep(ms + 120);
}

let stopRec = null;
async function rec(name) {
  const dir = join(FRAMES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  stopRec = await b.screencast(dir);
  meta[name] = { deviceScale: SCALE, viewport: VIEW, rects: {} };
  mark(`${name}:start`);
}
async function endRec(name) {
  if (!stopRec) return;
  mark(`${name}:end`);
  const frames = await stopRec();
  stopRec = null;
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  log(`${name}: ${frames.length} frames over ${span.toFixed(1)}s`);
}
async function rect(clip, key, finder) {
  const r = await rectOf(finder);
  if (r) meta[clip].rects[key] = r;
  else log(`WARN rect ${clip}.${key} not found`);
}
async function open(base, route, settle = 7000) {
  await b.goto(base + route, settle);
  await js(OVERLAY);
  await parkMouse();
  if (await js(`/Application error|Something went wrong|This page could not be found/.test(document.body.innerText.slice(0, 600))`)) log("WARN: page shows an error?", route);
}

// The run id comes back as the X-Run-Id header of POST /api/investigate.
let lastRunId = null;
async function events(base) {
  if (!lastRunId) throw new Error("no run id seen");
  const r = await fetch(`${base}/api/investigate?run=${lastRunId}&from=0`);
  const txt = await r.text();
  try { const j = JSON.parse(txt); return Array.isArray(j) ? j : j.events ?? []; } catch { return txt.split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
}
const lastOf = (ev, t) => ev.filter((e) => e.type === t).at(-1);
const phaseSeconds = async () => Number((await js(`document.querySelector('.phase-label')?.textContent ?? ''`)).match(/in ([\d.]+)\s*s/)?.[1] ?? NaN);
/** The figures the film quotes from a recorded run. */
function summarize(ev, url, seconds) {
  const items = ev.filter((e) => e.type === "evidence").map((e) => e.item);
  const q = items.filter((i) => i.query?.sql);
  const n = lastOf(ev, "narrative"), plan = lastOf(ev, "plan"), red = lastOf(ev, "redteam"), led = lastOf(ev, "ledger");
  return {
    url, at: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", seconds,
    queries: q.length, onZetaris: q.filter((i) => i.query.executedVia === "ZETARIS_CLOUD").length,
    root: led?.root ?? null, chain: items.map((i) => i.chainHash).filter(Boolean).slice(0, 8),
    planVia: plan?.via ?? plan?.source ?? null, redteamVia: red?.via ?? red?.source ?? null,
    explanationVia: n?.via ?? n?.source ?? null, explanationCached: !!n?.cached, fallbackFrom: n?.fallbackFrom ?? null,
    guard: n?.guard ? { checked: n.guard.checked, verified: n.guard.verified } : null,
    objections: (red?.objections ?? []).slice(0, 3).map((o) => ({ objection: o.objection, result: o.result })),
    verdict: lastOf(ev, "action")?.plan?.causes?.map((c) => c.group) ?? [],
  };
}

// ---------------------------------------------------------------- clips
const CLIPS = {};

/** Production: the intake, the run (H-MEM convergence, every query on Zetaris), then the explanation, red team and gate. */
CLIPS.run_live = async () => {
  await open(LIVE, "/app", 8000);
  await waitFor(`document.querySelectorAll('.feed-row, .card').length > 3`, 20000, "intake");
  await rec("run_live");
  await rect("run_live", "chips", `document.querySelector('.topbar .chips')`);
  await rect("run_live", "intake", LEFT);
  await sleep(2600);
  await press(byText("button", "Run investigation", "document.querySelector('.topbar')"), 400);
  mark("run_live.run");
  await waitFor(`${card("H-MEM convergence")}?.textContent.includes('131')`, 60000, "convergence");
  mark("run_live.converged");
  await rect("run_live", "convergence", card("H-MEM convergence"));
  await rect("run_live", "graph", `document.querySelector('.dag-wrap')`);
  await rect("run_live", "stepper", `document.querySelector('.stepper')`);
  await waitFor(`/complete/i.test(document.querySelector('.phase-label')?.textContent ?? '')`, 300000, "run complete");
  mark("run_live.done");
  const seconds = await phaseSeconds();
  await sleep(2400);
  await scrollPaneTo(CENTER, card("Explain why"), 2200, 40);
  mark("run_live.explain");
  await rect("run_live", "explain", card("Explain why"));
  await rect("run_live", "redteam", card("Red team"));
  await sleep(2800);
  await scrollPaneTo(RIGHT, card("Evidence gate"), 2000, 30);
  mark("run_live.gate");
  await rect("run_live", "gate", card("Evidence gate"));
  await sleep(3200);
  await endRec("run_live");
  const ev = await events(LIVE);
  const status = await (await fetch(`${LIVE}/api/status`)).json().catch(() => ({}));
  liveData.live = { ...summarize(ev, LIVE.replace(/^https?:\/\//, "") + "/app", seconds), parity: !!status?.zetaris?.parity?.ok, zetarisMode: status?.zetaris?.mode ?? null };
  log("live", JSON.stringify({ ...liveData.live, chain: liveData.live.chain.length, objections: liveData.live.objections.length }));
};

/** Production, same page: open an exhibit (SQL, rows, hash), then replay the whole chain. */
CLIPS.proof_live = async () => {
  await js(`window.__ease(${CENTER}, 'scrollTop', 0, 1200)`);
  await js(`window.__ease(${RIGHT}, 'scrollTop', 0, 10)`);
  await sleep(1500);
  await rec("proof_live");
  await rect("proof_live", "graph", `document.querySelector('.dag-wrap')`);
  await sleep(1400);
  await press(`[...document.querySelectorAll('.dag-node')].find((g) => g.textContent.includes('Sun Belt'))`, 900);
  mark("proof_live.exhibit");
  await rect("proof_live", "modal", `document.querySelector('.modal')`);
  await sleep(3800);
  await press(byText("button", "Close", "document.querySelector('.modal')"), 800);
  await scrollPaneTo(RIGHT, card("Proof ledger"), 1800, 120);
  await rect("proof_live", "ledger", card("Proof ledger"));
  await press(byText("button", "Replay & verify"), 300);
  mark("proof_live.replay");
  await waitFor(`/Verified\\./.test(${card("Proof ledger")}?.textContent ?? '')`, 120000, "verified");
  mark("proof_live.verified");
  await rect("proof_live", "verified", card("Proof ledger"));
  await sleep(3000);
  await endRec("proof_live");
};

/** This Mac: the top bar (Nightshift online), a full run, then the model cards labelled by Nightshift. */
CLIPS.nightshift_local = async () => {
  await open(LOCAL, "/app", 8000);
  await rec("nightshift_local");
  await rect("nightshift_local", "chips", `document.querySelector('.topbar .chips')`);
  await sleep(2400);
  await press(byText("button", "Run investigation", "document.querySelector('.topbar')"), 400);
  mark("nightshift_local.run");
  await waitFor(`/complete/i.test(document.querySelector('.phase-label')?.textContent ?? '')`, 300000, "run complete");
  mark("nightshift_local.done");
  const seconds = await phaseSeconds();
  await sleep(1600);
  await scrollPaneTo(CENTER, card("Explain why"), 2200, 40);
  mark("nightshift_local.explain");
  await rect("nightshift_local", "explain", card("Explain why"));
  await rect("nightshift_local", "redteam", card("Red team"));
  await sleep(3000);
  await scrollPaneTo(CENTER, card("Agent trace"), 2000, 40);
  mark("nightshift_local.trace");
  await rect("nightshift_local", "trace", card("Agent trace"));
  await sleep(3000);
  await endRec("nightshift_local");
  const ev = await events(LOCAL);
  liveData.nightshift = summarize(ev, "localhost · this Mac · /app", seconds);
  log("nightshift", JSON.stringify({ ...liveData.nightshift, chain: liveData.nightshift.chain.length }));
};

/** This Mac, same page: the disposition, then a named approval of the surgical quarantine. */
CLIPS.act_local = async () => {
  await js(`window.__ease(${RIGHT}, 'scrollTop', 0, 600)`);
  await sleep(800);
  await rec("act_local");
  await rect("act_local", "cost", card("Recall cost"));
  await sleep(2200);
  await scrollPaneTo(RIGHT, card("Human approval"), 1800, 120);
  await rect("act_local", "approve", card("Human approval"));
  await press(`${card("Human approval")}?.querySelector('input')`, 300);
  await typeText("VP Quality");
  await sleep(500);
  await press(`${card("Human approval")}?.querySelector('button.btn.danger')`, 400);
  mark("act_local.approved");
  await sleep(3600);
  await rect("act_local", "result", card("Human approval"));
  await sleep(1600);
  await endRec("act_local");
};

// ---------------------------------------------------------------- run
const order = Object.keys(CLIPS).filter(want);
b = await launch({ width: VIEW.w, height: VIEW.h, extraArgs: [`--force-device-scale-factor=${SCALE}`] });
await b.send("Network.enable");
b.on("Network.responseReceived", (p) => {
  if (/\/api\/investigate$/.test(p.response?.url ?? "") && p.response.headers) {
    const id = p.response.headers["X-Run-Id"] ?? p.response.headers["x-run-id"];
    if (id) { lastRunId = id; log("run id", id); }
  }
});
await b.send("Emulation.setDeviceMetricsOverride", { width: VIEW.w, height: VIEW.h, deviceScaleFactor: SCALE, mobile: false });
const hardStop = setTimeout(() => { log("HARD TIMEOUT"); b.close(); process.exit(2); }, 1_800_000);
try {
  for (const name of order) {
    log("clip", name);
    try { await CLIPS[name](); } catch (e) { log(`CLIP ${name} FAILED`, e.message); if (stopRec) await endRec(name); }
    save();
  }
} finally {
  save();
  if (b.consoleLines.length) log("console:", b.consoleLines.slice(0, 12).join("\n"));
  clearTimeout(hardStop);
  b.close();
}
