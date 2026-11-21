// A route as a list of legs (one per graph edge), placed along the route's polyline in navigation metres.
// Maneuvers and shade guidance both read the route through these.
import type { Graph, Route } from '../routing/index.ts';
import type { NavPath } from './progress.ts';

export interface Leg {
  id: string; // edge id
  from: string; // node walked from
  to: string; // node walked to
  start_m: number; // metres along the polyline where this leg begins
  end_m: number;
  length_m: number; // the graph's own length (contract metres), used for sun minutes
  name?: string;
}

export function buildLegs(route: Route, graph: Graph, nav: NavPath): Leg[] {
  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  const edges = route.edges.map((id) => byId.get(id)).filter((e) => !!e);
  if (!edges.length || edges.length !== route.edges.length) return [];

  // Edge geometry runs a → b and route.coords drops the shared vertex between edges, so each edge adds
  // (vertices − 1) polyline vertices. If that doesn't add up to the polyline, fall back to graph lengths.
  const idx = [0];
  for (const e of edges) idx.push(idx[idx.length - 1] + e.geometry.length - 1);
  const exact = idx[idx.length - 1] === nav.path.pts.length - 1;
  const graphTotal = edges.reduce((s, e) => s + e.length_m, 0) || 1;
  let acc = 0;
  return edges.map((e, i) => {
    const start_m = exact ? nav.path.cum[idx[i]] : (acc / graphTotal) * nav.path.total;
    acc += e.length_m;
    const end_m = exact ? nav.path.cum[idx[i + 1]] : (acc / graphTotal) * nav.path.total;
    return { id: e.id, from: route.nodes[i], to: route.nodes[i + 1], start_m, end_m, length_m: e.length_m, name: e.name };
  });
}

/** The leg being walked at distance s (the last leg once s passes the end). */
export function legAt(legs: Leg[], s: number): Leg | undefined {
  for (const l of legs) if (s < l.end_m) return l;
  return legs[legs.length - 1];
}
