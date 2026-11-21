// Self-check: npm run check:nav (maneuvers and legs)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouter, type Graph, type GraphEdge, type LonLat, type Route, type ShadeData } from '../routing/index.ts';
import { makeProjector, type XY } from './geo.ts';
import { buildLegs, legAt } from './legs.ts';
import { buildManeuvers, classify, instruction, nextManeuver } from './maneuvers.ts';
import { buildNavPath } from './progress.ts';

const ORIGIN: LonLat = [153.031522, -27.460061];
const proj = makeProjector(ORIGIN);
const ll = (p: XY) => proj.toLonLat(p);

// A tiny street grid in metres. Main St runs east along y = 0; Elm St crosses it at x = 60.
const POS: Record<string, XY> = { M0: [0, 0], M1: [30, 0], M2: [60, 0], M3: [90, 0], M4: [120, 0], Es: [60, -30], En: [60, 30], En2: [60, 60] };
type EdgeSpec = [id: string, a: string, b: string, name?: string, via?: XY[]];
function makeGraph(specs: EdgeSpec[], pos: Record<string, XY> = POS) {
  const ids = [...new Set(specs.flatMap(([, a, b]) => [a, b]))];
  const edges: GraphEdge[] = specs.map(([id, a, b, name, via]) => {
    const pts = [pos[a], ...(via ?? []), pos[b]];
    let length_m = 0;
    for (let i = 1; i < pts.length; i++) length_m += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { id, a, b, length_m, name, geometry: pts.map(ll) };
  });
  const graph: Graph = {
    version: 1, bbox: [0, 0, 1, 1], venue: { name: 'v', lon: ORIGIN[0], lat: ORIGIN[1], node: ids[0] },
    nodes: ids.map((id) => ({ id, lon: ll(pos[id])[0], lat: ll(pos[id])[1] })), edges,
  };
  return graph;
}
// Walk a list of nodes, orienting each edge's geometry the way the router does.
function routeOf(graph: Graph, nodes: string[]): Route {
  const edges: string[] = [];
  const coords: LonLat[] = [];
  nodes.slice(1).forEach((to, i) => {
    const from = nodes[i];
    const e = graph.edges.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from))!;
    edges.push(e.id);
    const g = e.a === from ? e.geometry : [...e.geometry].reverse();
    coords.push(...(i ? g.slice(1) : g));
  });
  return { nodes, edges, coords };
}
const run = (graph: Graph, nodes: string[]) => {
  const route = routeOf(graph, nodes);
  const nav = buildNavPath(route.coords, ORIGIN);
  return { route, nav, legs: buildLegs(route, graph, nav), ms: buildManeuvers(route, graph, nav) };
};
const kinds = (ms: { kind: string }[]) => ms.map((m) => m.kind);

const GRID: EdgeSpec[] = [
  ['m01', 'M0', 'M1', 'Main St'], ['m12', 'M1', 'M2', 'Main St'], ['m23', 'M2', 'M3', 'Main St'], ['m34', 'M3', 'M4', 'Main St'],
  ['e_s', 'M2', 'Es', 'Elm St'], ['e_n', 'M2', 'En', 'Elm St'], ['e_nn', 'En', 'En2', 'Elm St'],
];
const grid = makeGraph(GRID);

// classify: thresholds and sides (positive = right).
assert.equal(classify(5), 'straight');
assert.equal(classify(-30), 'slight-left');
assert.equal(classify(80), 'right');
assert.equal(classify(-90), 'left');
assert.equal(classify(140), 'sharp-right');
assert.equal(classify(-178), 'uturn');

// East along Main St, then north up Elm St = a left turn at the junction (x = 60). Mid-block nodes are skipped.
{
  const { ms, legs, nav } = run(grid, ['M0', 'M1', 'M2', 'En', 'En2']);
  assert.deepEqual(kinds(ms), ['depart', 'left', 'arrive']);
  assert.ok(Math.abs(ms[1].at_m - 60) < 0.5, `turn at ${ms[1].at_m}`);
  assert.equal(ms[1].street, 'Elm St');
  assert.equal(ms[1].from_street, 'Main St');
  assert.equal(instruction(ms[0]), 'Head east on Main St');
  assert.equal(instruction(ms[1]), 'Turn left onto Elm St');
  assert.ok(Math.abs(ms[2].at_m - nav.path.total) < 1e-9);
  assert.equal(legs.length, 4);
  assert.equal(legAt(legs, 10)?.id, 'm01');
  assert.equal(legAt(legs, 70)?.id, 'e_n');
  assert.equal(legAt(legs, 9999)?.id, 'e_nn');
  assert.equal(nextManeuver(ms, 10).m.kind, 'left');
  assert.equal(nextManeuver(ms, 100).m.kind, 'arrive');
}
// East then south = a right turn.
assert.deepEqual(kinds(run(grid, ['M0', 'M1', 'M2', 'Es']).ms), ['depart', 'right', 'arrive']);
// West along Main St then north up Elm St = a right turn.
assert.deepEqual(kinds(run(grid, ['M4', 'M3', 'M2', 'En']).ms), ['depart', 'right', 'arrive']);
// Straight through a junction on the same street: nothing to announce.
assert.deepEqual(kinds(run(grid, ['M0', 'M1', 'M2', 'M3', 'M4']).ms), ['depart', 'arrive']);

// Straight on, but the street changes name at the junction: "Continue onto".
{
  const g = makeGraph(GRID.map((e) => (e[0] === 'm23' || e[0] === 'm34' ? [e[0], e[1], e[2], 'Main St East'] : e) as EdgeSpec));
  const { ms } = run(g, ['M0', 'M1', 'M2', 'M3', 'M4']);
  assert.deepEqual(kinds(ms), ['depart', 'straight', 'arrive']);
  assert.equal(instruction(ms[1]), 'Continue onto Main St East');
}
// No street names at all: the instruction still reads.
{
  const g = makeGraph(GRID.map((e) => [e[0], e[1], e[2]] as EdgeSpec));
  const { ms } = run(g, ['M0', 'M1', 'M2', 'En', 'En2']);
  assert.equal(instruction(ms[0]), 'Head east');
  assert.equal(instruction(ms[1]), 'Turn left');
}

// A corner inside one edge (a vertex, not a node) still counts: an L-shaped footpath.
{
  const pos: Record<string, XY> = { P: [0, 0], Q: [50, 40] };
  const g = makeGraph([['path', 'P', 'Q', 'The Path', [[50, 0]]]], pos);
  const { ms } = run(g, ['P', 'Q']);
  assert.deepEqual(kinds(ms), ['depart', 'left', 'arrive']); // east, then north
  assert.ok(Math.abs(ms[1].at_m - 50) < 1);
}
// A rounded corner drawn with several vertices is one turn, not several.
{
  const pos: Record<string, XY> = { P: [0, 0], Q: [51, 50] };
  const g = makeGraph([['curb', 'P', 'Q', 'The Path', [[44, 0], [48, 1], [50, 4], [51, 8]]]], pos);
  const { ms } = run(g, ['P', 'Q']);
  assert.deepEqual(kinds(ms), ['depart', 'left', 'arrive']);
}
// A gentle arc (radius 100 m, 60° long) is not a turn.
{
  const arc: XY[] = [];
  for (let a = 0; a <= 60; a += 3) arc.push([100 * Math.sin((a * Math.PI) / 180), 100 * (1 - Math.cos((a * Math.PI) / 180))]);
  const pos: Record<string, XY> = { P: arc[0], Q: arc[arc.length - 1] };
  const g = makeGraph([['arc', 'P', 'Q', 'Curve St', arc.slice(1, -1)]], pos);
  assert.deepEqual(kinds(run(g, ['P', 'Q']).ms), ['depart', 'arrive']);
}
// A one-point route (origin = destination) has just departure and arrival, and doesn't throw.
{
  const route: Route = { nodes: ['M0'], edges: [], coords: [ll(POS.M0)] };
  const nav = buildNavPath(route.coords, ORIGIN);
  assert.deepEqual(kinds(buildManeuvers(route, grid, nav)), ['depart', 'arrive']);
}

// Real graph: routes from the venue to a spread of places give ordered maneuvers, far fewer than there are edges.
{
  const root = new URL('../../public/data/', import.meta.url);
  const graph: Graph = JSON.parse(readFileSync(new URL('graph.json', root), 'utf8'));
  const shade: ShadeData = JSON.parse(readFileSync(new URL('shade.json', root), 'utf8'));
  const router = createRouter(graph, shade);
  const origin: LonLat = [graph.venue.lon, graph.venue.lat];
  let checked = 0;
  for (const n of graph.nodes.filter((_, i) => i % 40 === 0)) {
    const route = router.route(graph.venue.node, n.id, 5, 24);
    if (!route || route.edges.length < 4) continue;
    const nav = buildNavPath(route.coords, origin);
    const legs = buildLegs(route, graph, nav);
    assert.equal(legs.length, route.edges.length);
    assert.ok(Math.abs(legs[legs.length - 1].end_m - nav.path.total) < 1e-6, 'legs cover the polyline');
    const ms = buildManeuvers(route, graph, nav, legs);
    assert.equal(ms[0].kind, 'depart');
    assert.equal(ms[ms.length - 1].kind, 'arrive');
    for (let i = 1; i < ms.length; i++) assert.ok(ms[i].at_m >= ms[i - 1].at_m, 'ordered');
    assert.ok(ms.length - 2 <= legs.length / 2, `${ms.length - 2} turns over ${legs.length} edges`);
    checked++;
  }
  assert.ok(checked >= 5, `only ${checked} real routes checked`);
}

console.log('nav maneuvers self-check passed');
