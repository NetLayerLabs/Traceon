// Reviewer mode: a finished investigation saved as an immutable case with a
// shareable id, plus comments pinned to individual exhibits. Regulators,
// suppliers or counsel get every exhibit and the replay, read-only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { InvestigationEvent } from './investigation';

export interface SavedCase {
  id: string;
  createdAt: string;
  scenarioId: string;
  label: string;
  ledgerRoot: string;
  events: InvestigationEvent[];
}

export interface CaseComment {
  id: string;
  exhibitId: string | null; // null = a comment on the whole case
  author: string;
  role: string;
  text: string;
  at: string;
}

const dir = () => path.join(process.env.METERLESS_STORAGE_DIR || (process.env.VERCEL ? '/tmp/meterless-data' : path.join(process.cwd(), '.meterless-data')), 'cases');
const validId = (id: string) => /^case-[a-f0-9]{16}$/.test(id);

export function saveCase(events: InvestigationEvent[]): SavedCase {
  const ledger = [...events].reverse().find((e) => e.type === 'ledger') as Extract<InvestigationEvent, { type: 'ledger' }> | undefined;
  const scenario = events.find((e) => e.type === 'scenario') as Extract<InvestigationEvent, { type: 'scenario' }> | undefined;
  if (!ledger || !scenario || !events.some((e) => e.type === 'done')) throw new Error('Only a finished investigation can be shared');
  // The id is derived from the ledger root, so sharing the same case twice gives the same link.
  const id = `case-${crypto.createHash('sha256').update(ledger.root).digest('hex').slice(0, 16)}`;
  const existing = getCase(id);
  if (existing) return existing;
  const c: SavedCase = { id, createdAt: new Date().toISOString(), scenarioId: scenario.id, label: scenario.label, ledgerRoot: ledger.root, events };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify(c));
  return c;
}

export function getCase(id: string): SavedCase | null {
  if (!validId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${id}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

export function listComments(id: string): CaseComment[] {
  if (!validId(id)) return [];
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), `${id}.comments.json`), 'utf-8'));
  } catch {
    return [];
  }
}

export function addComment(id: string, input: { exhibitId?: string | null; author: string; role?: string; text: string }): CaseComment {
  if (!getCase(id)) throw new Error('Unknown case');
  const author = input.author.trim().slice(0, 60);
  const text = input.text.trim().slice(0, 2000);
  if (!author || !text) throw new Error('A name and a comment are required');
  const exhibitId = input.exhibitId && /^E-\d{2,4}$/.test(input.exhibitId) ? input.exhibitId : null;
  const comment: CaseComment = { id: crypto.randomUUID(), exhibitId, author, role: (input.role ?? 'Reviewer').trim().slice(0, 40) || 'Reviewer', text, at: new Date().toISOString() };
  const all = [...listComments(id), comment];
  fs.writeFileSync(path.join(dir(), `${id}.comments.json`), JSON.stringify(all.slice(-1000), null, 1));
  return comment;
}
