// Shared test helpers. Every test file gets its own temp storage directory so
// runs never touch the developer's demo memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function isolatedStorage(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `traceon-${name}-`));
  process.env.METERLESS_STORAGE_DIR = dir;
  return dir;
}

/** Make every outbound fetch fail, so tests never depend on the network. */
export function offline() {
  globalThis.fetch = (async () => {
    throw new Error('network disabled in tests');
  }) as typeof fetch;
}

export async function collect(run: (emit: (e: any) => void) => Promise<void>) {
  const events: any[] = [];
  await run((e) => events.push(e));
  return {
    events,
    of: (type: string) => events.filter((e) => e.type === type),
    one: (type: string) => events.filter((e) => e.type === type).at(-1),
  };
}
