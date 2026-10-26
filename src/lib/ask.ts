// Ask the case: questions about a finished investigation, answered only from
// that investigation's own record. Nemotron writes the answer; every figure in
// it must exist in the record (the same number guard as the explanation) and
// every citation must name a real exhibit. Without the model, the closest
// facts from the record are returned as they are.
import type { CaseView } from './caseView';
import { numberGuard } from './investigation';
import { nemotronChat, NEMOTRON_FAST_MODEL } from './nemotron';

export interface CaseFact {
  cite: string | null; // exhibit id
  text: string;
}

export interface AskAnswer {
  source: 'nemotron' | 'case-file';
  /** Which provider and route answered, when a model did. */
  via?: string;
  answer: string;
  citations: string[];
  /** The model cited nothing; these are the record lines holding the figures it quoted. */
  citationsInferred?: boolean;
  invalidCitations: string[];
  guard: { checked: number; verified: number; unverified: string[] };
  facts: CaseFact[];
}

export function caseFacts(view: CaseView): CaseFact[] {
  const facts: CaseFact[] = [];
  const last = (ids: string[]) => ids[ids.length - 1] ?? null;
  const byLabel = (label: string) => view.evidence.find((e) => e.label === label)?.id ?? null;
  for (const h of view.hypotheses) {
    // One fact per adjustment, citing the exact exhibit of that test.
    for (const a of h.adjusted ?? [])
      facts.push({ cite: byLabel(`${h.id} | ${a.controlFor}`), text: `${h.title} (${h.hotGroup}) holding ${a.controlLabel} fixed: ${a.aliased ? 'aliased, cannot be separated' : `${a.pLabel}, common odds ratio ${a.commonOddsRatio.toFixed(2)}`}` });
    facts.push({
      cite: byLabel(`${h.id} screen`) ?? last(h.evidenceIds),
      text: `${h.id} "${h.title}" (${h.claim}): status ${h.status}${h.hotGroup ? `, hottest group ${h.hotGroup}` : ''}${h.rawTest ? `, raw ${h.rawTest.pLabel}` : ''}${h.rawRR ? `, relative risk ${h.rawRR.rr.toFixed(1)} (95% CI ${h.rawRR.lo.toFixed(1)} to ${h.rawRR.hi.toFixed(1)})` : ''}${h.adjusted?.length ? `; controlling for other factors: ${h.adjusted.map((a) => `${a.controlLabel} ${a.aliased ? 'aliased' : a.pLabel}`).join(', ')}` : ''}. ${h.verdict ?? ''}`,
    });
  }
  for (const c of view.action?.causes ?? []) {
    const screen = view.evidence.find((e) => e.label === `${c.hypothesisId} screen`)?.id ?? null;
    facts.push({ cite: screen, text: `Confirmed cause ${c.column} = ${c.group}: ${c.units} units, ${c.failures} failures, rate ${c.ratePer10k.toFixed(1)}/10k (95% CI ${c.rateCI.lo.toFixed(1)} to ${c.rateCI.hi.toFixed(1)}) against ${c.baseRatePer10k.toFixed(1)}/10k elsewhere, relative risk ${c.rr.rr.toFixed(1)}, explains ${(c.coverage * 100).toFixed(1)}% of incidents. Remedy ${c.remedy}, cost $${c.costUsd}.` });
    for (const f of c.falsifiers) facts.push({ cite: view.evidence.find((e) => e.label === 'Falsification baseline')?.id ?? null, text: `Would falsify ${c.group}: ${f.label}. ${f.rule} (now ${f.current ?? 'n/a'}, threshold ${f.threshold ?? 'n/a'} ${f.unit})` });
  }
  if (view.action)
    facts.push({ cite: view.evidence.find((e) => e.label === 'Combined coverage')?.id ?? null, text: `Action plan: act on ${view.action.affectedUnits} units instead of recalling ${view.action.blanketUnits}; surgical cost $${view.action.surgicalCostUsd} vs blanket $${view.action.blanketCostUsd}, saving $${view.action.savingsUsd}. Projected incidents in 30 days without action: ${view.action.projectedIncidents30d} (90% range ${view.action.projectedRange.lo} to ${view.action.projectedRange.hi}).` });
  if (view.gate) facts.push({ cite: null, text: `Evidence gate ${view.gate.pass ? 'passed' : 'blocked action'}: ${view.gate.criteria.map((c) => `${c.label} ${c.na ? 'N/A' : c.pass ? 'pass' : 'fail'} (${c.detail})`).join('; ')}` });
  const rt = view.evidence.find((e) => e.label === 'Red-team review')?.id ?? null;
  for (const o of view.redteam?.objections ?? []) facts.push({ cite: rt, text: `Objection "${o.objection}": ${o.result} (${o.survived ? 'answered' : 'not answered'})` });
  if (view.timeline) facts.push({ cite: view.evidence.find((e) => e.label === 'Early-warning replay')?.id ?? null, text: `Early warning: first claim ${view.timeline.firstClaimDate}; alert would have fired on ${view.timeline.alertDate ?? 'never'} after ${view.timeline.claimsAtAlert} claims; ${view.timeline.claimsAfterAlert} claims came after that.` });
  for (const e of view.evidence) facts.push({ cite: e.id, text: `${e.label}: ${e.summary}` });
  return facts;
}

const STOP = new Set('the a an of to in is was why what how did does do and or for on it this that with not be by are were which who when than'.split(' '));
const words = (s: string) => s.toLowerCase().match(/[a-z0-9.-]+/g)?.filter((w) => !STOP.has(w)) ?? [];

function closestFacts(facts: CaseFact[], question: string, k = 4) {
  const q = new Set(words(question));
  return facts
    .map((f, i) => ({ f, i, score: words(f.text).filter((w) => q.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map((x) => x.f);
}

export async function askCase(view: CaseView, question: string): Promise<AskAnswer> {
  const facts = caseFacts(view);
  const known = new Set(view.evidence.map((e) => e.id));
  const record = facts.map((f) => `${f.cite ? `[${f.cite}] ` : ''}${f.text}`).join('\n');
  const reply = await nemotronChat({
    model: NEMOTRON_FAST_MODEL,
    thinking: false,
    maxTokens: 500,
    timeoutMs: 25_000,
    system:
      'You answer questions about one finished product-safety investigation, for a quality engineer. Use only the case record you are given; each line of it starts with the exhibit id that holds it. Answer in 2 to 4 sentences of plain prose (at most 120 words) that explain the reasoning, not only the result. Every sentence must end with the exhibit id it relies on in square brackets, for example: "Holding the cell batch fixed, the heat effect disappears (p = 0.23) [E-18]." Quote numbers exactly as written in the record; never compute new ones. If the record does not answer the question, say so in one sentence.',
    user: `Case record:\n${record}\n\nQuestion: ${question}`,
  });
  const text = reply.live ? reply.text.trim() : '';
  if (text) {
    const cited = [...new Set([...text.matchAll(/\[(E-\d{2,4})\]/g)].map((m) => m[1]))];
    const valid = cited.filter((c) => known.has(c));
    let inferred: string[] = [];
    if (!valid.length) {
      const nums = (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((x) => x.replace(/,/g, '')).filter((x) => x.length > 1 && !['10', '30', '90', '95'].includes(x));
      const holders = facts.filter((f) => f.cite && nums.some((x) => f.text.replace(/,/g, '').includes(x)));
      inferred = [...new Set((holders.length ? holders : closestFacts(facts, question)).map((f) => f.cite!).filter(Boolean))].slice(0, 3);
    }
    return {
      source: 'nemotron',
      via: reply.via,
      answer: text,
      citations: valid.length ? valid : inferred,
      ...(inferred.length ? { citationsInferred: true } : {}),
      invalidCitations: cited.filter((c) => !known.has(c)),
      guard: numberGuard(text, facts.map((f) => f.text)),
      facts: closestFacts(facts, question),
    };
  }
  const near = closestFacts(facts, question);
  const answer = near.length ? near.map((f) => `${f.text}${f.cite ? ` [${f.cite}]` : ''}`).join('\n\n') : 'The case record has nothing on that. Try asking about a suspect, the cause, the cost or what would overturn the verdict.';
  return { source: 'case-file', answer, citations: near.map((f) => f.cite).filter((c): c is string => Boolean(c)), invalidCitations: [], guard: numberGuard(answer, facts.map((f) => f.text)), facts: near };
}
