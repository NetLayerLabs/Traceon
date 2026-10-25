// Signed, timestamped proof. The ledger root already proves *what* the
// evidence was; this proves *who* vouched for it and *when*:
//   - an Ed25519 signature by this deployment's key over a short statement,
//   - an OpenTimestamps proof that the statement existed at that time,
//     anchored in Bitcoin by the public calendars (no account, no fee).
// Anyone can check it offline: `ots verify statement.txt.ots` and the
// signature with the published public key.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = () => path.join(process.env.METERLESS_STORAGE_DIR || (process.env.VERCEL ? '/tmp/meterless-data' : path.join(process.cwd(), '.meterless-data')), 'proof');

export const OTS_CALENDARS = ['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org', 'https://a.pool.eternitywall.com'];
// DetachedTimestampFile header: magic, major version 1, then the file-hash op (0x08 = SHA-256).
const OTS_MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');

interface KeyPair {
  privatePem: string;
  publicPem: string;
}

function keys(): KeyPair {
  // A configured key wins, so a deployment keeps one identity across restarts.
  if (process.env.TRACEON_SIGNING_KEY) {
    const priv = crypto.createPrivateKey(process.env.TRACEON_SIGNING_KEY.replace(/\\n/g, '\n'));
    return { privatePem: priv.export({ type: 'pkcs8', format: 'pem' }).toString(), publicPem: crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString() };
  }
  const file = path.join(dir(), 'signing-key.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const kp = { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    try {
      fs.mkdirSync(dir(), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(kp), { mode: 0o600 });
    } catch {
      // Read-only filesystem: the key lives for this process only.
    }
    return kp;
  }
}

export function publicKey() {
  const pem = keys().publicPem;
  const raw = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).subarray(-32);
  return { algorithm: 'Ed25519', pem, fingerprint: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16) };
}

export interface ProofStamp {
  root: string;
  statement: string;
  statementSha256: string;
  signedAt: string;
  signature: string; // base64
  key: { algorithm: string; fingerprint: string; pem: string };
  ots: { calendar: string; file: string /* base64 .ots */; status: 'pending' } | null;
  otsError?: string;
}

export function statementFor(root: string, signedAt: string, scenarioId: string, count: number) {
  return `Traceon proof ledger\nroot: ${root}\nscenario: ${scenarioId}\nexhibits: ${count}\nsigned-at: ${signedAt}\n`;
}

async function submitOts(digest: Buffer): Promise<{ calendar: string; file: Buffer } | { error: string }> {
  let last = 'no calendar answered';
  for (const cal of OTS_CALENDARS) {
    try {
      const res = await fetch(`${cal}/digest`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.opentimestamps.v1', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'traceon' },
        body: new Uint8Array(digest),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        last = `${cal} answered ${res.status}`;
        continue;
      }
      const body = Buffer.from(await res.arrayBuffer());
      return { calendar: cal, file: Buffer.concat([OTS_MAGIC, Buffer.from([0x01, 0x08]), digest, body]) };
    } catch (err) {
      last = `${cal}: ${(err as Error).message}`;
    }
  }
  return { error: last };
}

const stamps = () => path.join(dir(), 'stamps');

export async function stampRoot(root: string, scenarioId: string, count: number): Promise<ProofStamp> {
  if (!/^[a-f0-9]{64}$/.test(root)) throw new Error('Not a ledger root');
  const existing = readStamp(root);
  if (existing?.ots) return existing;
  const signedAt = new Date().toISOString();
  const statement = statementFor(root, signedAt, scenarioId, count);
  const digest = crypto.createHash('sha256').update(statement).digest();
  const kp = keys();
  const signature = crypto.sign(null, Buffer.from(statement), kp.privatePem).toString('base64');
  const ots = await submitOts(digest);
  const pk = publicKey();
  const stamp: ProofStamp = {
    root,
    statement,
    statementSha256: digest.toString('hex'),
    signedAt,
    signature,
    key: { algorithm: pk.algorithm, fingerprint: pk.fingerprint, pem: pk.pem },
    ots: 'error' in ots ? null : { calendar: ots.calendar, file: ots.file.toString('base64'), status: 'pending' },
    ...('error' in ots ? { otsError: ots.error } : {}),
  };
  try {
    fs.mkdirSync(stamps(), { recursive: true });
    fs.writeFileSync(path.join(stamps(), `${root}.json`), JSON.stringify(stamp));
  } catch {
    // Not persisted on a read-only filesystem; the caller still gets the stamp.
  }
  return stamp;
}

export function readStamp(root: string): ProofStamp | null {
  if (!/^[a-f0-9]{64}$/.test(root)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(stamps(), `${root}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

export function verifySignature(statement: string, signatureB64: string, publicPem: string) {
  try {
    return crypto.verify(null, Buffer.from(statement), publicPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
