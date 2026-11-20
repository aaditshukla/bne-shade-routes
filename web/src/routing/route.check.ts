// Self-check: npm run check:routing
import assert from 'node:assert/strict';
import { buildGraph, nearestNode, route, summary, type Edge, type SunFractions } from './index.ts';

// A square: A–B–D is short and sunny, A–C–D is 20 m longer and shaded.
const edges: Edge[] = [
  { id: 'ab', u: 'A', v: 'B', length_m: 100 },
  { id: 'bd', u: 'B', v: 'D', length_m: 100 },
  { id: 'ac', u: 'A', v: 'C', length_m: 110 },
  { id: 'cd', u: 'C', v: 'D', length_m: 110 },
  { id: 'xy', u: 'X', v: 'Y', length_m: 5 }, // disconnected
];
const sun: SunFractions = { ab: [1, 0], bd: [1, 0], ac: [0, 0], cd: [0, 0], xy: [1, 1] };
const g = buildGraph(edges);

const shortest = route(g, sun, 'A', 'D', 0, 0)!;
assert.deepEqual(shortest.nodes, ['A', 'B', 'D']);
const shady = route(g, sun, 'A', 'D', 5, 0)!;
assert.deepEqual(shady.nodes, ['A', 'C', 'D']);

// Slot 1: everything is shaded, so even α = 10 takes the short way.
assert.deepEqual(route(g, sun, 'A', 'D', 10, 1)!.nodes, ['A', 'B', 'D']);

// Works in reverse (undirected), and the same node returns an empty route.
assert.deepEqual(route(g, sun, 'D', 'A', 5, 0)!.nodes, ['D', 'C', 'A']);
assert.deepEqual(route(g, sun, 'A', 'A', 5, 0), { nodes: ['A'], edges: [] });
assert.equal(route(g, sun, 'A', 'X', 0, 0), null);

const s = summary(shortest, sun, 0);
assert.equal(s.distance_m, 200);
assert.ok(Math.abs(s.sunMinutes - 200 / 1.3 / 60) < 1e-9);
assert.equal(summary(shady, sun, 0).sunMinutes, 0);

// Heap ordering on a longer chain with a costly shortcut.
const chain: Edge[] = [];
for (let i = 0; i < 50; i++) chain.push({ id: `c${i}`, u: `n${i}`, v: `n${i + 1}`, length_m: 1 });
chain.push({ id: 'jump', u: 'n0', v: 'n50', length_m: 49 });
assert.equal(route(buildGraph(chain), {}, 'n0', 'n50', 0, 0)!.edges.length, 1);
const chainSun = Object.fromEntries(chain.map((e) => [e.id, [e.id === 'jump' ? 1 : 0]]));
assert.equal(route(buildGraph(chain), chainSun, 'n0', 'n50', 0.1, 0)!.edges.length, 50);

// Random graphs: Dijkstra's cost must match brute-force Bellman–Ford.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (let trial = 0; trial < 50; trial++) {
  const n = 40;
  const es: Edge[] = [];
  const sn: SunFractions = {};
  for (let i = 0; i < 120; i++) {
    const e = { id: `e${i}`, u: `n${(rand() * n) | 0}`, v: `n${(rand() * n) | 0}`, length_m: 1 + rand() * 50 };
    es.push(e);
    sn[e.id] = [rand()];
  }
  const alpha = rand() * 10;
  const cost = (e: Edge) => e.length_m * (1 + alpha * sn[e.id][0]);
  const best: Record<string, number> = { n0: 0 };
  for (let k = 0; k < n; k++)
    for (const e of es)
      for (const [a, b] of [[e.u, e.v], [e.v, e.u]])
        if ((best[a] ?? Infinity) + cost(e) < (best[b] ?? Infinity)) best[b] = best[a] + cost(e);
  const r = route(buildGraph(es), sn, 'n0', 'n1', alpha, 0);
  if (best.n1 === undefined) assert.equal(r, null);
  else assert.ok(Math.abs(r!.edges.reduce((s, e) => s + cost(e), 0) - best.n1) < 1e-6, `trial ${trial}`);
}

// nearestNode: at 60°S a degree of lon is half a degree of lat, so 'a' (≈83 m) beats 'b' (≈111 m).
assert.equal(nearestNode({ a: [0.0015, -60], b: [0, -60.001] }, [0, -60]), 'a');
assert.equal(nearestNode({}, [0, 0]), null);

console.log('routing self-check passed');
