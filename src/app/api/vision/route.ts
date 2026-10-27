import { NextResponse } from 'next/server';
import { PRODUCT_NAME } from '@/lib/enterpriseData';
import { readJson } from '@/lib/http';
import { analyzeDefectPhoto } from '@/lib/vision';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function POST(req: Request) {
  const raw = await readJson<{ image?: unknown }>(req, 9_000_000);
  if (raw instanceof Response) return raw;
  const { image } = raw ?? {};
  // Raster photos only: an SVG is markup, not a photo.
  if (typeof image !== 'string' || !/^data:image\/(png|jpe?g|webp);/.test(image)) return NextResponse.json({ error: 'image must be a PNG, JPEG or WebP data: URL' }, { status: 400 });
  if (image.length > 8_000_000) return NextResponse.json({ error: 'image too large (max ~6MB)' }, { status: 413 });
  return NextResponse.json(await analyzeDefectPhoto(image, PRODUCT_NAME));
}
