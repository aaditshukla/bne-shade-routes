// Turn-by-turn from a route. Graph edges are split into pieces of 30 m or less, so most nodes are mid-block:
// a maneuver is only announced at a real junction (3+ edges), where the street name changes, or where the
// path itself bends sharply. Bearings are read over a few metres either side, so curves read correctly.
import type { Graph, Route } from '../routing/index.ts';
import { angleDiff, bearingAt } from './geo.ts';
import { buildLegs, type Leg } from './legs.ts';
import type { NavPath } from './progress.ts';

export type ManeuverKind =
  | 'depart' | 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'uturn' | 'arrive';

export interface Maneuver {
  at_m: number; // metres along the route
  kind: ManeuverKind;
  angle: number; // signed turn in degrees, positive = right; for 'depart' the compass bearing
  street?: string; // the street you end up on
  from_street?: string;
}

const SPAN_M = 8; // how far either side of a point the walking direction is read
const MERGE_M = 10; // candidates closer than this are one corner
const STRAIGHT = 20;
const BEND = 55; // a bend this sharp counts as a turn even without a junction
const DEGREES = { slight: 55, turn: 125, sharp: 165 };

const degrees = new WeakMap<Graph, Map<string, number>>();
function degreeOf(graph: Graph, node: string): number {
  let d = degrees.get(graph);
  if (!d) {
    d = new Map();
    for (const e of graph.edges) for (const n of [e.a, e.b]) d.set(n, (d.get(n) ?? 0) + 1);
    degrees.set(graph, d);
  }
  return d.get(node) ?? 0;
}

export function classify(angle: number): ManeuverKind {
  const a = Math.abs(angle);
  if (a < STRAIGHT) return 'straight';
  const side = angle > 0 ? 'right' : 'left';
  if (a < DEGREES.slight) return `slight-${side}`;
  if (a < DEGREES.turn) return side;
  if (a < DEGREES.sharp) return `sharp-${side}`;
  return 'uturn';
}

interface Candidate {
  at_m: number;
  inB: number;
  outB: number;
  deg: number;
  nameIn?: string;
  nameOut?: string;
}

const named = (a?: string, b?: string) => !!a && !!b && a !== b;

function emits(c: Candidate): boolean {
  const a = Math.abs(angleDiff(c.outB, c.inB));
  return c.deg >= 3 ? a >= STRAIGHT || named(c.nameIn, c.nameOut) : a >= BEND;
}

export function buildManeuvers(route: Route, graph: Graph, nav: NavPath, legs: Leg[] = buildLegs(route, graph, nav)): Maneuver[] {
  const { path } = nav;
  const out: Maneuver[] = [];
  const first = legs[0];
  out.push({ at_m: 0, kind: 'depart', angle: bearingAt(path, SPAN_M / 2, SPAN_M), street: first?.name });
  if (!legs.length || path.pts.length < 3) return [...out, { at_m: path.total, kind: 'arrive', angle: 0 }];

  // Every interior polyline vertex is a candidate: corners can sit inside an edge, not only at nodes.
  const nodeAt = new Map<number, string>(); // polyline distance (rounded to mm) -> node id
  for (const l of legs) nodeAt.set(Math.round(l.end_m * 1000), l.to);
  const legBefore = (s: number) => legs.find((l) => s > l.start_m + 1e-6 && s <= l.end_m + 1e-6);
  const legAfter = (s: number) => legs.find((l) => s >= l.start_m - 1e-6 && s < l.end_m - 1e-6);

  const picked: Candidate[][] = [];
  for (let i = 1; i < path.pts.length - 1; i++) {
    const at = path.cum[i];
    const node = nodeAt.get(Math.round(at * 1000));
    const c: Candidate = {
      at_m: at,
      inB: bearingAt(path, at - SPAN_M / 2, SPAN_M),
      outB: bearingAt(path, at + SPAN_M / 2, SPAN_M),
      deg: node ? degreeOf(graph, node) : 2,
      nameIn: legBefore(at)?.name,
      nameOut: legAfter(at)?.name,
    };
    if (!emits(c)) continue;
    const group = picked[picked.length - 1];
    if (group && at - group[group.length - 1].at_m < MERGE_M) group.push(c);
    else picked.push([c]);
  }

  for (const group of picked) {
    const head = group[0];
    const tail = group[group.length - 1];
    const merged: Candidate = {
      // Pinned where the corner is sharpest, preferring a real junction.
      ...group.reduce((best, c) => {
        const score = (x: Candidate) => Math.abs(angleDiff(x.outB, x.inB)) + (x.deg >= 3 ? 1 : 0);
        return score(c) > score(best) ? c : best;
      }),
      inB: head.inB,
      outB: tail.outB,
      deg: Math.max(...group.map((c) => c.deg)),
      nameIn: head.nameIn,
      nameOut: tail.nameOut,
    };
    if (!emits(merged)) continue;
    const angle = angleDiff(merged.outB, merged.inB);
    out.push({ at_m: merged.at_m, kind: classify(angle), angle, street: merged.nameOut, from_street: merged.nameIn });
  }
  out.push({ at_m: path.total, kind: 'arrive', angle: 0 });
  return out;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassWord = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

const TURN_WORDS: Record<string, string> = {
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  left: 'Turn left',
  right: 'Turn right',
  'sharp-left': 'Turn sharp left',
  'sharp-right': 'Turn sharp right',
  uturn: 'Make a U-turn',
};

/** "Turn left onto Ann Street", "Continue onto X", "Head north on X", "Arrive". */
export function instruction(m: Maneuver): string {
  if (m.kind === 'arrive') return 'Arrive at your destination';
  if (m.kind === 'depart') return `Head ${compassWord(m.angle)}${m.street ? ` on ${m.street}` : ''}`;
  if (m.kind === 'straight') return m.street ? `Continue onto ${m.street}` : 'Continue straight';
  return `${TURN_WORDS[m.kind]}${m.street && m.street !== m.from_street ? ` onto ${m.street}` : m.street ? ` on ${m.street}` : ''}`;
}

/** The next maneuver ahead of distance s (arrival is always last), and its index. */
export function nextManeuver(ms: Maneuver[], s: number): { m: Maneuver; i: number } {
  for (let i = 1; i < ms.length; i++) if (ms[i].at_m > s + 1) return { m: ms[i], i };
  return { m: ms[ms.length - 1], i: ms.length - 1 };
}
