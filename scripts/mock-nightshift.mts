// STAND-IN for Meterless Nightshift, for development and tests only. It speaks
// the protocol Meterless documents for its local runtime: OpenAI-compatible
// /v1 on 127.0.0.1:8088, a bearer token, the meterless-app header, and
// meterless/* routing modes listed by GET /v1/models. It is not Nightshift:
// with NVIDIA_API_KEY set it forwards requests to Nemotron on NVIDIA NIM,
// otherwise it answers with a fixed reply.
// Usage: npm run nightshift:standin  (prints the token to put in .env.local)
import http from 'node:http';
import fs from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const PORT = Number(process.env.MOCK_NIGHTSHIFT_PORT ?? 8088);
const TOKEN = process.env.MOCK_NIGHTSHIFT_TOKEN ?? 'standin-token';
const MODES = ['auto', 'fast', 'deep', 'cheap', 'local', 'fusion', 'vision', 'text', 'vision.fast', 'text.deep'].map((r) => `meterless/${r}`);
// With an NVIDIA key, the stand-in behaves like a Nightshift with the NVIDIA
// API connected: Nemotron models appear in the list and are called directly.
const NEMOTRON = ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b'];
const ROUTES = process.env.NVIDIA_API_KEY && process.env.MOCK_NIGHTSHIFT_NEMOTRON !== 'off' ? [...MODES, ...NEMOTRON] : MODES;
const UPSTREAM: Record<string, { model: string; thinking: boolean }> = {
  'meterless/vision': { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', thinking: false },
  'meterless/deep': { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', thinking: false },
};
const FALLBACK_UPSTREAM = { model: 'nvidia/nemotron-3.5-lightning-30b-a3b', thinking: false };

const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    if (req.url === '/healthz') return send(res, 200, { ok: true, standIn: true });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/v1/models') return send(res, 200, { object: 'list', standIn: true, data: ROUTES.map((id) => ({ id, object: 'model', owned_by: 'meterless' })) });
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      if (!req.headers['meterless-app']) return send(res, 400, { error: 'meterless-app header is required' });
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      if (!ROUTES.includes(body.model)) return send(res, 404, { error: `unknown route ${body.model}` });
      if (process.env.NVIDIA_API_KEY) {
        const direct = NEMOTRON.includes(body.model);
        const up = direct ? { model: body.model, thinking: body.chat_template_kwargs?.enable_thinking ?? false } : (UPSTREAM[body.model] ?? FALLBACK_UPSTREAM);
        const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
          body: JSON.stringify({ ...body, model: up.model, chat_template_kwargs: { enable_thinking: up.thinking } }),
          signal: AbortSignal.timeout(120_000),
        }).catch((e) => e as Error);
        if (r instanceof Error) return send(res, 502, { error: r.message });
        const data = await r.json();
        return send(res, r.status, { ...data, model: body.model, system_fingerprint: 'nightshift-standin' });
      }
      const content = 'Stand-in reply: Meterless Nightshift is not installed, and no upstream model is configured.';
      return send(res, 200, { id: 'standin', object: 'chat.completion', model: body.model, system_fingerprint: 'nightshift-standin', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
    }
    send(res, 404, { error: 'not found' });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Nightshift STAND-IN on http://127.0.0.1:${PORT}/v1  token: ${TOKEN}`);
    console.log(process.env.NVIDIA_API_KEY ? `NVIDIA connected: lists ${ROUTES.length - MODES.length} Nemotron models and forwards everything to NIM.` : 'No NVIDIA_API_KEY: fixed replies.');
    console.log(`For Traceon: NIGHTSHIFT_TOKEN=${TOKEN}`);
  });
