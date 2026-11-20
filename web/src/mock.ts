// shortcut: a hand-made 7×7 street grid around the venue so routes draw before real data exists.
// Delete once web/public/data/graph.json and shade.json land (tomorrow, from Data).
import type { Edge, SunFractions } from './routing/index.ts';
import { VENUE } from './ui/presets.ts';

const SPACING_M = 70;
const DLON = SPACING_M / (111_320 * Math.cos((VENUE[1] * Math.PI) / 180));
const DLAT = SPACING_M / 110_574;
const SLOTS = 51;

export const nodes: Record<string, [number, number]> = {};
export const edges: Edge[] = [];
export const sun: SunFractions = {};

const id = (r: number, c: number) => `n${r}_${c}`;
for (let r = 0; r < 7; r++)
  for (let c = 0; c < 7; c++) nodes[id(r, c)] = [VENUE[0] + (c - 3) * DLON, VENUE[1] + (r - 3) * DLAT];

// shortcut: crude sine sun curve (sunrise 04:46, 82.4° at 11:34, sunset 18:22); real alt_deg comes from shade.json.
export const slots = Array.from({ length: SLOTS }, (_, i) => ({
  alt_deg: 82.4 * Math.sin((Math.PI * (6 + i / 4 - 4.77)) / (18.37 - 4.77)),
}));

// Row 4 is tree-lined all day; column 1 sits in building shadow before 10:00, column 5 after 14:00.
function add(a: string, b: string, shadedAt: (hour: number) => boolean) {
  const e = { id: `${a}-${b}`, u: a, v: b, length_m: SPACING_M };
  edges.push(e);
  sun[e.id] = slots.map(({ alt_deg }, i) => (alt_deg <= 0 ? 0 : shadedAt(6 + i / 4) ? 0.1 : 0.9));
}
for (let r = 0; r < 7; r++)
  for (let c = 0; c < 7; c++) {
    if (c < 6) add(id(r, c), id(r, c + 1), () => r === 4);
    if (r < 6) add(id(r, c), id(r + 1, c), (h) => (c === 1 && h < 10) || (c === 5 && h >= 14));
  }

export const START = id(3, 3); // the venue
