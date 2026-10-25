// Contract-test double for the Zetaris SaaS SQL API, built from the published
// OpenAPI spec (api.saas.enterprise.zetaris.com/redoc/docs.yaml). It enforces
// the required headers and bearer token, pages results at pageLimit, and
// deliberately returns shuffled rows with stringified numbers so the adapter's
// normalization and hash canonicalization are exercised.
// Usage: npx tsx scripts/mock-zetaris.mts  (listens on :4599, schema "traceon")
import http from 'node:http';
import crypto from 'node:crypto';
import alasql from 'alasql';
import { getEnterpriseMesh } from '../src/lib/enterpriseData.ts';

const PORT = Number(process.env.MOCK_ZETARIS_PORT ?? 4599);
const TOKEN = 'mock-api-token';
const mesh = getEnterpriseMesh();
const db = new alasql.Database('traceon');
const load = (name: string, data: unknown[]) => {
  db.exec(`CREATE TABLE ${name}`);
  (db as unknown as { tables: Record<string, { data: unknown[] }> }).tables[name].data = data;
};
load('erp_production_lots', mesh.lots);
load('supplier_bom_lineage', mesh.bom);
load('unit_fact', mesh.units);
load('warranty_claims', mesh.claims);
load('warehouses', mesh.warehouses);

const cursors = new Map<string, Record<string, unknown>[]>();
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const sparkify = (rows: Record<string, unknown>[]) =>
  rows
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])))
    .sort(() => Math.random() - 0.5);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (!uuidRe.test(String(req.headers['x-request-id'] ?? ''))) return send(res, 400, 'Invalid value for: header X-Request-ID');
    if (!/^\d+$/.test(String(req.headers['x-org-id'] ?? ''))) return send(res, 400, 'Invalid value for: header X-Org-ID');
    if (url.pathname === '/api/v1.0/auth/login') {
      if (!String(req.headers.authorization).startsWith('Basic ')) return send(res, 404, { msg: 'unauthorized' });
      return send(res, 200, { idToken: TOKEN, refreshToken: 'mock-refresh' });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { msg: 'invalid token' });

    if (req.method === 'POST' && url.pathname === '/api/v1.0/query/sql/start') {
      let raw = '';
      for await (const c of req) raw += c;
      const { select, pageLimit } = JSON.parse(raw);
      if (!select || !(pageLimit >= 1 && pageLimit <= 100)) return send(res, 400, 'Invalid value for: body');
      let rows: Record<string, unknown>[];
      try {
        rows = sparkify(db.exec(String(select).replace(/\btraceon\./g, '')) as Record<string, unknown>[]);
      } catch (e) {
        return send(res, 500, { msg: `SQL error: ${(e as Error).message}` });
      }
      const queryToken = crypto.randomUUID();
      cursors.set(queryToken, rows);
      const totalPages = Math.max(1, Math.ceil(rows.length / pageLimit));
      return send(res, 200, { records: rows.slice(0, pageLimit), pageNumber: 1, pageLimit, totalCount: rows.length, totalPages, queryToken });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1.0/query/sql/page') {
      const rows = cursors.get(url.searchParams.get('queryToken') ?? '');
      const limit = Number(url.searchParams.get('pageLimit'));
      const n = Number(url.searchParams.get('pageNumber'));
      if (!rows) return send(res, 404, { msg: 'unknown queryToken' });
      return send(res, 200, { queryToken: url.searchParams.get('queryToken'), pageNumber: n, records: rows.slice((n - 1) * limit, n * limit), totalCount: rows.length, totalPages: Math.ceil(rows.length / limit) });
    }
    const close = url.pathname.match(/^\/api\/v1\.0\/query\/sql\/close\/(.+)$/);
    if (req.method === 'DELETE' && close) {
      cursors.delete(decodeURIComponent(close[1]));
      return send(res, 200, '');
    }
    send(res, 404, { msg: 'not found' });
  })
  .listen(PORT, () => console.log(`mock Zetaris on :${PORT}`));
