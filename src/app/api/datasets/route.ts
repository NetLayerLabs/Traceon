import { NextResponse } from 'next/server';
import { LIMITS, listDatasets, parseCsv, profile, saveDataset, validateMapping } from '@/lib/datasets';
import type { DatasetMapping } from '@/lib/datasets';
import { readJson } from '@/lib/http';
import { activeRun } from '@/lib/runRegistry';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ datasets: listDatasets(), limits: LIMITS });
}

// Reading a 25 MB file takes a few hundred MB for a moment; two at a time keeps the shared host safe.
let reading = 0;

// POST {name, csv} profiles the file for the mapping screen; with a mapping
// it validates and stores the dataset and returns its scenario id.
export async function POST(req: Request) {
  // Refuse oversized bodies before reading them into memory.
  if (Number(req.headers.get('content-length') ?? 0) > LIMITS.maxBytes * 1.2) return NextResponse.json({ error: `File is larger than ${LIMITS.maxBytes / 1e6} MB` }, { status: 413 });
  if (reading >= 2) return NextResponse.json({ error: 'The server is reading other uploads; try again in a few seconds' }, { status: 429, headers: { 'Retry-After': '5' } });
  reading++;
  try {
    return await handle(req);
  } finally {
    reading--;
  }
}

async function handle(req: Request) {
  const body = await readJson<{ name?: string; csv?: string; mapping?: DatasetMapping }>(req, LIMITS.maxBytes * 1.2);
  if (body instanceof Response) return body;
  if (!body?.csv || typeof body.csv !== 'string') return NextResponse.json({ error: 'csv text is required' }, { status: 400 });
  if (body.csv.length > LIMITS.maxBytes) return NextResponse.json({ error: `File is larger than ${LIMITS.maxBytes / 1e6} MB` }, { status: 413 });
  let table: string[][];
  try {
    table = parseCsv(body.csv.replace(/^﻿/, ''));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  if (table.length < 2) return NextResponse.json({ error: 'Need a header row and at least one data row' }, { status: 400 });
  const columns = table[0].map((c, i) => c.trim() || `column_${i + 1}`);
  const rows = table.slice(1);
  if (rows.length > LIMITS.maxRows) return NextResponse.json({ error: `At most ${LIMITS.maxRows.toLocaleString('en-US')} rows` }, { status: 413 });
  if (!body.mapping) {
    return NextResponse.json({ columns, rowCount: rows.length, preview: rows.slice(0, 8), profile: profile(columns, rows) });
  }
  const problem = validateMapping(columns, rows, body.mapping);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  try {
    // Making room never removes the dataset an investigation is running on.
    const running = activeRun()?.scenarioId.split('@')[0];
    const ds = saveDataset(String(body.name ?? 'Uploaded data'), columns, rows, body.mapping, running ? [running] : []);
    return NextResponse.json({ id: ds.id, name: ds.name, rows: rows.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 507 });
  }
}
