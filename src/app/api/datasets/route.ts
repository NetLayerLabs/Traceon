import { NextResponse } from 'next/server';
import { LIMITS, listDatasets, parseCsv, profile, saveDataset, validateMapping } from '@/lib/datasets';
import type { DatasetMapping } from '@/lib/datasets';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ datasets: listDatasets(), limits: LIMITS });
}

// POST {name, csv} profiles the file for the mapping screen; with a mapping
// it validates and stores the dataset and returns its scenario id.
export async function POST(req: Request) {
  // Refuse oversized bodies before reading them into memory.
  if (Number(req.headers.get('content-length') ?? 0) > LIMITS.maxBytes * 1.2) return NextResponse.json({ error: `File is larger than ${LIMITS.maxBytes / 1e6} MB` }, { status: 413 });
  const body = (await req.json().catch(() => null)) as { name?: string; csv?: string; mapping?: DatasetMapping } | null;
  if (!body?.csv || typeof body.csv !== 'string') return NextResponse.json({ error: 'csv text is required' }, { status: 400 });
  if (body.csv.length > LIMITS.maxBytes) return NextResponse.json({ error: `File is larger than ${LIMITS.maxBytes / 1e6} MB` }, { status: 413 });
  const table = parseCsv(body.csv.replace(/^﻿/, ''));
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
    const ds = saveDataset(String(body.name ?? 'Uploaded data'), columns, rows, body.mapping);
    return NextResponse.json({ id: ds.id, name: ds.name, rows: rows.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 507 });
  }
}
