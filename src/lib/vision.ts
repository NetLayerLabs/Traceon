// Defect-photo forensics with Nemotron 3.5 Super VL. Without a key (or if the
// call fails) it returns a reference analysis of the bundled sample photo,
// marked live=false so the UI can label it.
import { extractJson, nemotronChat, NEMOTRON_MODEL } from './nemotron';
import type { VisionFinding } from './investigation';

const REFERENCE: VisionFinding = {
  live: false,
  model: 'reference analysis (offline)',
  physicalFailureMode: 'Localized thermal scorching consistent with high-resistance joint heating',
  suspectedComponent: 'Discharge connector pin 4 / cell anode tab weld',
  severityScore: 86,
  isManufacturingDefectLikely: true,
  visualEvidenceSummary:
    'Carbonized discoloration concentrated on one connector pin while adjacent pins are clean; heat pattern radiates from the pin, not from the cell body, pointing to a joint defect rather than ambient heat.',
  bbox: { x: 0.48, y: 0.36, w: 0.2, h: 0.34 },
};

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
  if (!reply.live) return { ...REFERENCE, reasoning: reply.error };
  const parsed = extractJson<Omit<VisionFinding, 'live' | 'model'>>(reply.text);
  if (!parsed?.physicalFailureMode) return { ...REFERENCE, reasoning: `Model reply was not valid JSON: ${reply.text.slice(0, 200)}` };
  return { ...parsed, live: true, model: reply.model, reasoning: reply.reasoning.slice(0, 1500) };
}
