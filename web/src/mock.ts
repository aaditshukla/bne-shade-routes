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

// Row 4 (one block north of the venue) and column 1 are tree-lined; everything else is mostly sunny.
function add(a: string, b: string, shaded: boolean) {
  const e = { id: `${a}-${b}`, u: a, v: b, length_m: SPACING_M };
  edges.push(e);
  sun[e.id] = Array(SLOTS).fill(shaded ? 0.1 : 0.9);
}
for (let r = 0; r < 7; r++)
  for (let c = 0; c < 7; c++) {
    if (c < 6) add(id(r, c), id(r, c + 1), r === 4);
    if (r < 6) add(id(r, c), id(r + 1, c), c === 1);
  }

export const START = id(3, 3); // the venue
