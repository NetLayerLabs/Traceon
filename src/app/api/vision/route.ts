import { NextResponse } from 'next/server';
import { PRODUCT_NAME } from '@/lib/enterpriseData';
import { analyzeDefectPhoto } from '@/lib/vision';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function POST(req: Request) {
  const { image } = (await req.json()) as { image?: string };
  if (!image?.startsWith('data:image/')) return NextResponse.json({ error: 'image must be a data: URL' }, { status: 400 });
  if (image.length > 8_000_000) return NextResponse.json({ error: 'image too large (max ~6MB)' }, { status: 413 });
  return NextResponse.json(await analyzeDefectPhoto(image, PRODUCT_NAME));
}
