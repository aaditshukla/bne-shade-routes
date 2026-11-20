// Self-check: npm run check:routing
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouter, type Graph, type GraphEdge, type ShadeData } from './index.ts';

// Tiny graphs: nodes on a line at lat 0 (positions only matter for nearestNode), edges straight a → b.
function make(spec: [id: string, a: string, b: string, len: number][], sunFraction: Record<string, number[]>) {
  const ids = [...new Set(spec.flatMap(([, a, b]) => [a, b]))];
  const pos = (id: string): [number, number] => [ids.indexOf(id) * 0.001, 0];
  const edges: GraphEdge[] = spec.map(([id, a, b, length_m]) => ({ id, a, b, length_m, geometry: [pos(a), pos(b)] }));
  const graph: Graph = {
    version: 1, bbox: [0, 0, 1, 1], venue: { name: 'v', lon: 0, lat: 0, node: ids[0] },
    nodes: ids.map((id) => ({ id, lon: pos(id)[0], lat: 0 })), edges,
  };
  const shade = { sunFraction } as ShadeData;
  return createRouter(graph, shade);
}

// A square: A–B–D is short and sunny, A–C–D is 20 m longer and shaded.
const sq = make(
  [['ab', 'A', 'B', 100], ['bd', 'B', 'D', 100], ['ac', 'A', 'C', 110], ['cd', 'C', 'D', 110], ['xy', 'X', 'Y', 5]],
  { ab: [1, 0], bd: [1, 0], ac: [0, 0], cd: [0, 0], xy: [1, 1] },
);
const shortest = sq.route('A', 'D', 0, 0)!;
assert.deepEqual(shortest.nodes, ['A', 'B', 'D']);
assert.deepEqual(shortest.edges, ['ab', 'bd']);
assert.deepEqual(sq.route('A', 'D', 5, 0)!.nodes, ['A', 'C', 'D']);
// Slot 1: everything is shaded, so even α = 10 takes the short way.
assert.deepEqual(sq.route('A', 'D', 10, 1)!.nodes, ['A', 'B', 'D']);
// Undirected: walking D → A follows bd backwards, so coords must start at D (lon 0.002) and end at A.
const back = sq.route('D', 'A', 0, 0)!;
assert.deepEqual(back.nodes, ['D', 'B', 'A']);
assert.deepEqual(back.coords, [[0.002, 0], [0.001, 0], [0, 0]]);
assert.deepEqual(sq.route('A', 'A', 5, 0), { nodes: ['A'], edges: [], coords: [[0, 0]] });
assert.equal(sq.route('A', 'X', 0, 0), null);

const s = sq.summarize(shortest, 0);
assert.equal(s.distance_m, 200);
assert.ok(Math.abs(s.sun_min - 200 / 1.3 / 60) < 1e-9);
assert.ok(Math.abs(s.walk_min - 200 / 1.3 / 60) < 1e-9);
assert.equal(sq.summarize(sq.route('A', 'D', 5, 0)!, 0).sun_min, 0);

// nearestNode ranks in metres: B is at lon 0.001; a tap at lon 0.0009 is nearer B than A.
assert.equal(sq.nearestNode(0.0009, 0), 'B');

// Heap ordering on a longer chain with a costly shortcut.
const chain: [string, string, string, number][] = [];
for (let i = 0; i < 50; i++) chain.push([`c${i}`, `n${i}`, `n${i + 1}`, 1]);
chain.push(['jump', 'n0', 'n50', 49]);
assert.equal(make(chain, {}).route('n0', 'n50', 0, 0)!.edges.length, 1);
const chainSun = Object.fromEntries(chain.map(([id]) => [id, [id === 'jump' ? 1 : 0]]));
assert.equal(make(chain, chainSun).route('n0', 'n50', 0.1, 0)!.edges.length, 50);

// Random graphs: Dijkstra's cost must match brute-force Bellman–Ford.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (let trial = 0; trial < 50; trial++) {
  const n = 40;
  const es: [string, string, string, number][] = [];
  const sn: Record<string, number[]> = {};
  for (let i = 0; i < 120; i++) {
    let u = (rand() * n) | 0, v = (rand() * n) | 0;
    if (u === v) v = (v + 1) % n;
    es.push([`e${i}`, `n${u}`, `n${v}`, 1 + rand() * 50]);
    sn[`e${i}`] = [rand()];
  }
  const alpha = rand() * 10;
  const cost = Object.fromEntries(es.map(([id, , , len]) => [id, len * (1 + alpha * sn[id][0])]));
  const best: Record<string, number> = { n0: 0 };
  for (let k = 0; k < n; k++)
    for (const [id, u, v] of es)
      for (const [a, b] of [[u, v], [v, u]])
        if ((best[a] ?? Infinity) + cost[id] < (best[b] ?? Infinity)) best[b] = best[a] + cost[id];
  const r = make(es, sn).route('n0', 'n1', alpha, 0);
  if (best.n1 === undefined) assert.equal(r, null);
  else assert.ok(Math.abs(r!.edges.reduce((t, id) => t + cost[id], 0) - best.n1) < 1e-6, `trial ${trial}`);
}

// The data files the app actually loads (fixtures until real data lands). README: at 12:00 to South St 4,
// shortest is 240 m / ~2.05 sun-min and shadiest (α = 5) is 334 m / ~1.12 sun-min.
const dataDir = new URL('../../public/data/', import.meta.url);
const graph: Graph = JSON.parse(readFileSync(new URL('graph.json', dataDir), 'utf8'));
const shade: ShadeData = JSON.parse(readFileSync(new URL('shade.json', dataDir), 'utf8'));
const router = createRouter(graph, shade);
for (const e of graph.edges) assert.ok(shade.sunFraction[e.id]?.length === 51, `sunFraction for ${e.id}`);
const s4 = graph.nodes.find((x) => x.name === 'South St 4');
if (s4 && graph.edges.length === 13) {
  const a = router.summarize(router.route(graph.venue.node, s4.id, 0, 24)!, 24);
  const b = router.summarize(router.route(graph.venue.node, s4.id, 5, 24)!, 24);
  assert.ok(Math.abs(a.distance_m - 240) < 1 && Math.abs(a.sun_min - 2.05) < 0.01, JSON.stringify(a));
  assert.ok(Math.abs(b.distance_m - 334) < 1 && Math.abs(b.sun_min - 1.12) < 0.01, JSON.stringify(b));
}
// Every route's polyline is continuous: each edge's geometry joins the next at a shared node.
const far = router.nearestNode(graph.bbox[2], graph.bbox[3]);
const r = router.route(graph.venue.node, far, 5, 24)!;
const at = (id: string) => graph.nodes.find((x) => x.id === id)!;
assert.deepEqual(r.coords[0], [at(r.nodes[0]).lon, at(r.nodes[0]).lat]);
assert.deepEqual(r.coords.at(-1), [at(far).lon, at(far).lat]);

console.log('routing self-check passed');
