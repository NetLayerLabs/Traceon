// Builds public/samples/charger-returns.csv: a small, realistic upload for the
// "Your data" page. One resin lot is defective; it was mostly moulded on
// night shift, so the shift looks guilty too (a confounder to rule out).
import fs from 'node:fs';
let seed = 20261025;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const lots = Array.from({ length: 18 }, (_, i) => `R-${2190 + i}`);
const rows = ['serial,resin_lot,mold_cavity,shift,line,region,ship_date,days_in_field,returned,failure_date,symptom'];
const base = Date.parse('2026-05-01');
for (let i = 0; i < 12000; i++) {
  const lot = pick(lots);
  const bad = lot === 'R-2207';
  const shift = bad ? (rand() < 0.8 ? 'Night' : 'Day') : pick(['Day', 'Day', 'Night', 'Swing']);
  const ship = base + Math.floor(rand() * 120) * 864e5;
  const days = Math.floor((Date.parse('2026-10-20') - ship) / 864e5);
  const p = (bad ? 0.07 : 0.004) * Math.min(1, days / 90);
  const failed = rand() < p;
  const fdate = failed ? new Date(ship + Math.floor(rand() * days) * 864e5).toISOString().slice(0, 10) : '';
  const symptom = failed ? (bad ? pick(['housing cracked near USB-C port, charger hot', 'crack by port, burning smell', 'case split at port, got very hot']) : pick(['stopped charging', 'cable frayed', 'LED does not light', 'charger warm'])) : '';
  rows.push([`CH-${100000 + i}`, lot, `C${1 + Math.floor(rand() * 8)}`, shift, `L${1 + Math.floor(rand() * 4)}`, pick(['US-West', 'US-East', 'US-South', 'EU', 'APAC']), new Date(ship).toISOString().slice(0, 10), days, failed ? 'yes' : 'no', fdate, symptom.includes(',') ? `"${symptom}"` : symptom].join(','));
}
fs.writeFileSync('public/samples/charger-returns.csv', rows.join('\n') + '\n');
console.log(rows.length - 1, 'rows');
