// Request bodies are read with a size cap, so an oversized POST is refused
// with 413 before it is held in memory (also when it has no content-length).
import { NextResponse } from 'next/server';

/** Default cap for routes whose bodies are a few small fields. */
export const SMALL_BODY = 64 * 1024;

/**
 * The parsed JSON body, null when it is missing or not JSON, or a 413
 * response when it is larger than `max` bytes.
 */
export async function readJson<T>(req: Request, max = SMALL_BODY): Promise<T | null | Response> {
  const tooLarge = () => NextResponse.json({ error: `Request body is larger than ${max >= 1e6 ? `${Math.round(max / 1e6)} MB` : `${Math.round(max / 1024)} KB`}` }, { status: 413 });
  if (Number(req.headers.get('content-length') ?? 0) > max) return tooLarge();
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T;
  } catch {
    return null;
  }
}
