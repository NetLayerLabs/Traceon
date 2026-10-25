// Deterministic statistics behind every verdict. The LLM never produces a
// p-value: it only gets to explain numbers computed here.

// ln Γ(x), Lanczos approximation.
function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Natural log of the regularized upper incomplete gamma Q(s, x).
// Computed in log space so very small p-values don't underflow to 0.
function lnUpperGammaQ(s: number, x: number): number {
  if (x <= 0) return 0;
  if (x < s + 1) {
    // series for P, then Q = 1 - P
    let sum = 1 / s;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    const lnP = Math.log(sum) - x + s * Math.log(x) - lnGamma(s);
    const p = Math.exp(lnP);
    return Math.log(Math.max(1e-300, 1 - p));
  }
  // continued fraction for Q (Lentz)
  let b = x + 1 - s;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.log(h) - x + s * Math.log(x) - lnGamma(s);
}

/** Upper-tail p-value of a chi-square statistic, plus its -log10 for display. */
export function chiSquarePValue(stat: number, df: number): { p: number; negLog10P: number } {
  if (!(stat > 0) || df <= 0) return { p: 1, negLog10P: 0 };
  const lnQ = lnUpperGammaQ(df / 2, stat / 2);
  return { p: Math.exp(lnQ), negLog10P: -lnQ / Math.LN10 };
}

export interface GroupCount {
  group: string;
  units: number;
  failures: number;
}

export interface IndependenceTest {
  test: 'chi-square independence' | 'Monte Carlo exact';
  chi2: number;
  df: number;
  p: number;
  negLog10P: number;
  groups: (GroupCount & { ratePer10k: number })[];
  maxRateRatio: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Monte Carlo exact p-value for the k×2 chi-square statistic: redistribute the
 * observed failures across groups in proportion to their units, many times,
 * and count how often the statistic is at least as extreme. Seeded from the
 * table, so the same data always gives the same p-value.
 */
function monteCarloP(groups: GroupCount[], observed: number, sims = 20_000): number {
  const totalUnits = groups.reduce((s, g) => s + g.units, 0);
  const totalFail = groups.reduce((s, g) => s + g.failures, 0);
  const pFail = totalFail / totalUnits;
  const cum: number[] = [];
  let acc = 0;
  for (const g of groups) cum.push((acc += g.units / totalUnits));
  const rand = mulberry32(Math.round(observed * 1000) ^ (totalFail * 7919) ^ groups.length);
  const counts = new Array<number>(groups.length);
  let extreme = 0;
  for (let s = 0; s < sims; s++) {
    counts.fill(0);
    for (let f = 0; f < totalFail; f++) {
      const r = rand();
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      counts[lo]++;
    }
    let chi2 = 0;
    for (let i = 0; i < groups.length; i++) {
      const eF = groups[i].units * pFail;
      const eO = groups[i].units - eF;
      if (eF > 0) chi2 += (counts[i] - eF) ** 2 / eF;
      if (eO > 0) chi2 += (groups[i].units - counts[i] - eO) ** 2 / eO;
    }
    if (chi2 >= observed - 1e-9) extreme++;
  }
  return (extreme + 1) / (sims + 1);
}

/**
 * Chi-square test of independence on a k×2 (group × failed/ok) table. When
 * expected counts are too small for the chi-square approximation (more than
 * 20% of cells under 5, or any under 1) the p-value comes from an exact Monte
 * Carlo test instead, because sparse tables make the approximation overstate
 * significance.
 */
export function chiSquareIndependence(groups: GroupCount[]): IndependenceTest {
  const totalUnits = groups.reduce((s, g) => s + g.units, 0);
  const totalFail = groups.reduce((s, g) => s + g.failures, 0);
  const pFail = totalFail / totalUnits;
  let chi2 = 0;
  for (const g of groups) {
    const eF = g.units * pFail;
    const eO = g.units * (1 - pFail);
    if (eF > 0) chi2 += (g.failures - eF) ** 2 / eF;
    if (eO > 0) chi2 += (g.units - g.failures - eO) ** 2 / eO;
  }
  const df = Math.max(1, groups.length - 1);
  let { p, negLog10P } = chiSquarePValue(chi2, df);
  let test: IndependenceTest['test'] = 'chi-square independence';
  const expected = groups.flatMap((g) => [g.units * pFail, g.units * (1 - pFail)]);
  const small = expected.filter((e) => e < 5).length;
  const invalid = small > 0.2 * expected.length || expected.some((e) => e < 1);
  // Astronomically small asymptotic p-values stay as-is: no simulation could
  // ever reach them, and the effect is unambiguous at any sample size.
  if (invalid && totalFail > 0 && totalFail <= 5_000 && p > 1e-6) {
    p = monteCarloP(groups, chi2);
    negLog10P = -Math.log10(p);
    test = 'Monte Carlo exact';
  }
  const rates = groups.map((g) => ({ ...g, ratePer10k: g.units ? (g.failures / g.units) * 10_000 : 0 }));
  const positive = rates.map((r) => r.ratePer10k).filter((r) => r > 0);
  const maxRateRatio = positive.length >= 2 ? Math.max(...positive) / Math.min(...positive) : positive.length ? Infinity : 1;
  return { test, chi2, df, p, negLog10P, groups: rates, maxRateRatio };
}

export interface Stratum {
  stratum: string;
  exposedUnits: number;
  exposedFailures: number;
  unexposedUnits: number;
  unexposedFailures: number;
}

export interface CmhResult {
  test: 'Cochran-Mantel-Haenszel';
  chi2: number;
  p: number;
  negLog10P: number;
  commonOddsRatio: number;
  strata: Stratum[];
}

/**
 * Cochran–Mantel–Haenszel test: does exposure still predict failure once we
 * hold a suspected confounder fixed? This is how Traceon tells a real cause
 * from a variable that only looks guilty because it travels with the cause.
 */
export function cochranMantelHaenszel(strata: Stratum[]): CmhResult {
  let sumA = 0;
  let sumE = 0;
  let sumV = 0;
  let orNum = 0;
  let orDen = 0;
  for (const s of strata) {
    const a = s.exposedFailures;
    const b = s.exposedUnits - s.exposedFailures;
    const c = s.unexposedFailures;
    const d = s.unexposedUnits - s.unexposedFailures;
    const n = a + b + c + d;
    if (n < 2) continue;
    const r1 = a + b;
    const c1 = a + c;
    sumA += a;
    sumE += (r1 * c1) / n;
    sumV += (r1 * (c + d) * c1 * (b + d)) / (n * n * (n - 1));
    orNum += (a * d) / n;
    orDen += (b * c) / n;
  }
  const chi2 = sumV > 0 ? (Math.abs(sumA - sumE) - 0.5) ** 2 / sumV : 0;
  const { p, negLog10P } = chiSquarePValue(Math.max(0, chi2), 1);
  return {
    test: 'Cochran-Mantel-Haenszel',
    chi2,
    p,
    negLog10P,
    commonOddsRatio: orDen > 0 ? orNum / orDen : Infinity,
    strata,
  };
}

const Z975 = 1.959963984540054; // exact 97.5% standard-normal quantile

/** Relative risk with a 95% CI (Katz log method). */
export function relativeRisk(exposedF: number, exposedN: number, unexposedF: number, unexposedN: number) {
  const a = Math.max(exposedF, 0.5);
  const c = Math.max(unexposedF, 0.5);
  const rr = a / exposedN / (c / unexposedN);
  const se = Math.sqrt(1 / a - 1 / exposedN + 1 / c - 1 / unexposedN);
  return { rr, lo: Math.exp(Math.log(rr) - Z975 * se), hi: Math.exp(Math.log(rr) + Z975 * se) };
}

export function formatP(p: number, negLog10P: number): string {
  if (negLog10P > 300) return 'p < 1e-300';
  if (negLog10P >= 4) {
    // Build mantissa/exponent from the log so tiny p-values never print as 0.
    const exp = Math.ceil(negLog10P);
    const mantissa = 10 ** (exp - negLog10P);
    return `p = ${mantissa.toFixed(1)}e-${exp}`;
  }
  return `p = ${p.toFixed(p < 0.01 ? 4 : 2)}`;
}

/** Wilson score interval for a proportion k/n (95% by default). */
export function wilson(k: number, n: number, z = Z975) {
  if (n <= 0) return { p: 0, lo: 0, hi: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { p, lo: Math.max(0, (c - r) / d), hi: Math.min(1, (c + r) / d) };
}

/** Chi-square quantile by bisection on the survival function (accurate to ~1e-9). */
export function chiSquareQuantile(prob: number, df: number): number {
  // prob is the lower-tail probability; find x with P(X <= x) = prob.
  let lo = 0;
  let hi = Math.max(10, df * 10);
  while (1 - chiSquarePValue(hi, df).p < prob) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (1 - chiSquarePValue(mid, df).p < prob) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-9 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

/** Exact (Garwood) confidence interval for a Poisson count k. */
export function poissonInterval(k: number, level = 0.95) {
  const a = 1 - level;
  return {
    lo: k === 0 ? 0 : chiSquareQuantile(a / 2, 2 * k) / 2,
    hi: chiSquareQuantile(1 - a / 2, 2 * k + 2) / 2,
  };
}
