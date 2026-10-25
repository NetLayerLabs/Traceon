// Scenario menu, shared by the server and the browser (no data generation here).
export interface ScenarioOption {
  id: string;
  label: string;
  blurb: string;
}

export const SCENARIO_OPTIONS: ScenarioOption[] = [
  { id: 'reference', label: 'Reference: defective cell batch', blurb: 'The demo story. One bad incoming cell batch, hidden behind heat and plant confounders.' },
  { id: 'firmware', label: 'Firmware bug', blurb: 'A firmware release overcharges packs. Rolled out first in the Sun Belt, so heat looks guilty.' },
  { id: 'two-causes', label: 'Two independent causes', blurb: 'A bad cell batch and a firmware bug at the same time. The agent must find both.' },
  { id: 'noise', label: 'No defect (noise only)', blurb: 'Plenty of complaints, no real cause. The evidence gate must block any recall.' },
  { id: 'random', label: 'Random hidden scenario', blurb: 'A new hidden cause from a random seed, revealed only after the verdict.' },
];
