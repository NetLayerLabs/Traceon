// Defect-photo forensics with Nemotron 3.5 Super VL. Without a key (or if the
// call fails) it returns a reference analysis of the bundled sample photo,
// marked live=false so the UI can label it.
import { extractJson, nemotronChat, NEMOTRON_MODEL } from './nemotron';
import crypto from 'node:crypto';
import type { VisionFinding } from './investigation';
import { singleton } from './singleton';

// Findings are kept server-side and referred to by id, so an investigation
// only ever uses an analysis this server actually produced.
const findings = singleton('vision', () => new Map<string, VisionFinding>());
function keep(f: VisionFinding): VisionFinding {
  const id = crypto.randomUUID();
  const out = { ...f, id };
  findings.set(id, out);
  while (findings.size > 50) findings.delete(findings.keys().next().value!);
  return out;
}
export function getVisionFinding(id: unknown): VisionFinding | null {
  return typeof id === 'string' ? findings.get(id) ?? null : null;
}

const REFERENCE: VisionFinding = {
  live: false,
  model: 'reference analysis (offline)',
  // Describes the bundled sample photo (NTSB, JAL Boeing 787 APU battery, 2013).
  physicalFailureMode: 'Thermal runaway: cells charred and vented, interconnects melted, case scorched from the inside',
  suspectedComponent: 'Lithium-ion cell module / terminal connector',
  severityScore: 92,
  isManufacturingDefectLikely: true,
  // Returned for any image when no model answers, so it says what it is: a description of the sample, not of this image.
  visualEvidenceSummary:
    'Reference description of the bundled NTSB sample photo (JAL Boeing 787 APU battery, 2013); no model looked at this image. Every cell is carbonised and the internal bus bars have melted, while the outer case is intact and burned from within: the fire started inside the pack, consistent with a cell-level fault propagating to its neighbours rather than external heat. The terminal connector block is charred.',
  bbox: { x: 0.28, y: 0.11, w: 0.47, h: 0.47 },
};

/**
 * Models return the damage box in different shapes: {x,y,w,h}, {x1,y1,x2,y2},
 * or a list of four numbers (corners when x2 > x1 and y2 > y1). Everything
 * becomes {x,y,w,h} in 0..1, or nothing if it cannot be read.
 */
export function normalizeBbox(b: unknown): VisionFinding['bbox'] | undefined {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  let x: number, y: number, w: number, h: number;
  if (Array.isArray(b) && b.length === 4) {
    const [a, c, d, e] = b.map(n);
    [x, y] = [a, c];
    if (d > a && e > c && (d + a > 1 || e + c > 1)) [w, h] = [d - a, e - c];
    else [w, h] = [d, e];
  } else if (b && typeof b === 'object') {
    const o = b as Record<string, unknown>;
    if ('x1' in o) [x, y, w, h] = [n(o.x1), n(o.y1), n(o.x2) - n(o.x1), n(o.y2) - n(o.y1)];
    else [x, y, w, h] = [n(o.x), n(o.y), n(o.w ?? o.width), n(o.h ?? o.height)];
  } else return undefined;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return undefined;
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x: c(x), y: c(y), w: c(w), h: c(h) };
}

export async function analyzeDefectPhoto(imageDataUrl: string, productContext: string): Promise<VisionFinding> {
  const reply = await nemotronChat({
    model: NEMOTRON_MODEL,
    user: [
      {
        type: 'text',
        text: `You are Traceon's product-safety vision inspector. Product: ${productContext}.
Inspect the customer-submitted photo. Output ONLY JSON:
{"physicalFailureMode":"physical mechanism you can see","suspectedComponent":"specific part, weld, seal or pin","severityScore":0-100,"isManufacturingDefectLikely":true|false,"visualEvidenceSummary":"forensic description citing visual cues","bbox":{"x":0-1,"y":0-1,"w":0-1,"h":0-1}}
bbox is the damaged region as fractions of image width/height. If the image does not show damage, say so.`,
      },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
    thinkingDeadlineMs: Number(process.env.NEMOTRON_THINKING_DEADLINE_MS ?? 25_000),
    maxTokens: 4096,
    timeoutMs: 75_000,
  });
  if (!reply.live) return keep({ ...REFERENCE, reasoning: reply.error });
  const parsed = extractJson<Omit<VisionFinding, 'live' | 'model'>>(reply.text);
  if (!parsed?.physicalFailureMode) return keep({ ...REFERENCE, reasoning: `Model reply was not valid JSON: ${reply.text.slice(0, 200)}` });
  // Say when another provider answered and why (Nightshift has no vision route), and when the reply is a cache replay.
  return keep({
    ...parsed,
    bbox: normalizeBbox(parsed.bbox),
    live: true,
    model: reply.via ?? reply.model,
    reasoning: reply.reasoning.slice(0, 1500),
    fallbackFrom: reply.fallbackFrom,
    cached: reply.cached,
  });
}
