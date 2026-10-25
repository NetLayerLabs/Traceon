// Builds the committed NHTSA snapshots used by the real-recall backtest.
// Public data from api.nhtsa.gov: target complaints (trimmed), comparator
// complaints aggregated per day, and the target's recalls. Re-run to refresh:
//   npx tsx scripts/snapshot-nhtsa.mts [rawCacheDir]
import fs from 'node:fs';
import path from 'node:path';
import { CASES, COMPARATORS, compactComparators, compactTarget, fetchNhtsa } from '../src/lib/realRecall.ts';

const raw = process.argv[2];
const out = path.join(process.cwd(), 'data', 'nhtsa');
fs.mkdirSync(out, { recursive: true });
for (const c of CASES) {
  const complaints = [];
  const recalls = [];
  for (const y of c.years) {
    complaints.push(...(await fetchNhtsa('complaints', c.make, c.model, y, raw)));
    recalls.push(...(await fetchNhtsa('recalls', c.make, c.model, y, raw)));
  }
  const comp = [];
  for (const [mk, md] of COMPARATORS) for (const y of c.years) comp.push(...(await fetchNhtsa('complaints', mk, md, y, raw)));
  const seen = new Set<string>();
  const snapshot = {
    id: c.id,
    vehicle: `${c.make} ${c.model}`,
    years: c.years,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: 'api.nhtsa.gov complaintsByVehicle and recallsByVehicle',
    complaints: compactTarget(complaints),
    comparators: compactComparators(comp),
    comparatorVehicles: COMPARATORS.map(([a, b]) => `${a} ${b}`),
    recalls: recalls
      .filter((r: any) => !seen.has(r.NHTSACampaignNumber) && seen.add(r.NHTSACampaignNumber))
      .map((r: any) => ({ campaign: r.NHTSACampaignNumber, date: r.ReportReceivedDate, component: r.Component, summary: String(r.Summary ?? '').slice(0, 400), consequence: String(r.Consequence ?? '').slice(0, 300) })),
  };
  const file = path.join(out, `${c.id}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot));
  console.log(`${c.id}: ${snapshot.complaints.length} complaints, ${comp.length} comparator complaints in ${snapshot.comparators.length} days, ${snapshot.recalls.length} recalls, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
