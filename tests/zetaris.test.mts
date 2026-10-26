// Zetaris resilience: hackathon clusters answer some internal faults (cold
// start, a dropped Thrift connection) with a 400. Those are retried; a real
// refusal is not; and a cluster that keeps failing is skipped for a minute
// instead of stalling every query of the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isolatedStorage } from './helpers.mts';

isolatedStorage('zetaris');
let plan: { status: number; body: string }[] = [];
let calls = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'DELETE') return res.end('{}');
  calls++;
  const next = plan.shift() ?? { status: 200, body: JSON.stringify({ queryToken: 't', records: [{ N: '7' }], totalPages: 1, pageNumber: 1 }) };
  res.writeHead(next.status, { 'Content-Type': 'application/json' });
  res.end(next.body);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
process.env.ZETARIS_API_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.ZETARIS_ORG_ID = '1';
process.env.ZETARIS_API_TOKEN = 'test-token';
const { runCloudQuery, runFederatedQuery } = await import('../src/lib/zetaris.ts');
const reset = (p: typeof plan) => ((plan = p), (calls = 0));

test('a transient cluster fault is retried and the query succeeds', async () => {
  reset([{ status: 400, body: 'Could not create ResultSet: null' }, { status: 400, body: 'org.apache.thrift.transport.TTransportException' }]);
  const rows = await runCloudQuery('SELECT COUNT(*) AS n FROM unit_fact');
  assert.deepEqual(rows, [{ n: 7 }]);
  assert.equal(calls, 3);
});

test('a real refusal is not retried', async () => {
  reset([{ status: 400, body: 'Table or view not found: unit_factz' }]);
  await assert.rejects(runCloudQuery('SELECT COUNT(*) AS n FROM unit_factz'), /Table or view not found/);
  assert.equal(calls, 1);
});

test('after repeated faults the cloud is skipped for a minute, with the reason in the exhibit', async () => {
  const fault = { status: 503, body: 'cluster unavailable' };
  reset([fault, fault, fault]);
  const first = await runFederatedQuery('SELECT COUNT(*) AS n FROM unit_fact', ['unit_fact'], 'reference');
  assert.equal(first.executedVia, 'LOCAL_FEDERATED_MIRROR');
  assert.equal(calls, 3);
  const second = await runFederatedQuery('SELECT COUNT(*) AS n FROM unit_fact', ['unit_fact'], 'reference');
  assert.equal(second.executedVia, 'LOCAL_FEDERATED_MIRROR');
  assert.equal(calls, 3, 'no further calls while the breaker is open');
  assert.match(second.fallbackReason ?? '', /skipped for \d+ s after repeated faults/);
  server.close();
});
