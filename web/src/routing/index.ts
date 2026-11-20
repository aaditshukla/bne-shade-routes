// Shade-aware routing, shaped to contracts/frontend-interface.md. Everything else imports routes from here.

export type LonLat = [lon: number, lat: number];

export interface GraphNode { id: string; lon: number; lat: number; name?: string }
export interface GraphEdge { id: string; a: string; b: string; length_m: number; name?: string; geometry: LonLat[] }
export interface Graph {
  version: 1;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  venue: { name: string; lon: number; lat: number; node: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface ShadeData {
  version: 1; date: string; tz: string; slot_minutes: 15;
  slots: string[];                                   // 51 × "HH:MM"
  sun: { alt_deg: number; az_deg: number }[];        // 51
  sunFraction: Record<string, number[]>;             // edge id -> 51 values in [0, 1]
}

export interface Route {
  nodes: string[];          // node ids, origin first
  edges: string[];          // edge ids in walking order (edges.length === nodes.length - 1)
  coords: LonLat[];         // the route as one [lon, lat] polyline, oriented in walking direction
}
export interface RouteSummary {
  distance_m: number;
  walk_min: number;         // distance_m / 1.3 / 60
  sun_min: number;          // Σ length_m × sunFraction[slot] / 1.3 / 60
}

export interface Router {
  /** Nearest graph node to a tapped point (planar distance in metres, not degrees). */
  nearestNode(lon: number, lat: number): string;
  /** Least-cost route at shade-hunger alpha (0 = shortest, up to 10) and slot (0..50); null if unreachable. */
  route(from: string, to: string, alpha: number, slot: number): Route | null;
  /** Distance, walking time and minutes in the sun for a route at a slot. */
  summarize(route: Route, slot: number): RouteSummary;
}

const WALK_SPEED_MS = 1.3;

/** Fetches graph.json and shade.json through Vite's base URL (never a hard-coded /data path). */
export async function loadData(): Promise<{ graph: Graph; shade: ShadeData }> {
  const get = async (path: string) => {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };
  const [graph, shade] = await Promise.all([get('graph.json'), get('shade.json')]);
  return { graph, shade };
}

export function createRouter(graph: Graph, shade: ShadeData): Router {
  // Undirected adjacency list, built once.
  const adj = new Map<string, { to: string; edge: GraphEdge }[]>();
  const link = (from: string, to: string, edge: GraphEdge) => {
    let list = adj.get(from);
    if (!list) adj.set(from, (list = []));
    list.push({ to, edge });
  };
  for (const e of graph.edges) {
    link(e.a, e.b, e);
    link(e.b, e.a, e);
  }
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  // Missing data counts as full sun, so a gap never looks shadier than it is.
  const sunAt = (id: string, slot: number) => shade.sunFraction[id]?.[slot] ?? 1;

  // Local metres around the venue: lon scaled by cos(lat), good to well under 1% across a 600 m bbox.
  const kx = 111_320 * Math.cos((graph.venue.lat * Math.PI) / 180);
  const ky = 110_574;

  return {
    nearestNode(lon, lat) {
      let best = graph.venue.node;
      let bestD = Infinity;
      for (const n of graph.nodes) {
        const d = ((n.lon - lon) * kx) ** 2 + ((n.lat - lat) * ky) ** 2;
        if (d < bestD) {
          bestD = d;
          best = n.id;
        }
      }
      return best;
    },

    // Dijkstra with cost length_m × (1 + α × sunFraction[slot]). α = 0 is the shortest route.
    route(from, to, alpha, slot) {
      const dist = new Map<string, number>([[from, 0]]);
      const prev = new Map<string, { node: string; edge: GraphEdge }>();
      const heap = new MinHeap();
      heap.push(0, from);

      while (heap.size) {
        const [d, node] = heap.pop();
        if (node === to) break;
        if (d > dist.get(node)!) continue; // stale heap entry
        for (const { to: next, edge } of adj.get(node) ?? []) {
          const nd = d + edge.length_m * (1 + alpha * sunAt(edge.id, slot));
          if (nd < (dist.get(next) ?? Infinity)) {
            dist.set(next, nd);
            prev.set(next, { node, edge });
            heap.push(nd, next);
          }
        }
      }

      if (!dist.has(to)) return null;
      const nodes = [to];
      const edges: GraphEdge[] = [];
      for (let n = to; n !== from; ) {
        const p = prev.get(n)!;
        edges.push(p.edge);
        nodes.push((n = p.node));
      }
      nodes.reverse();
      edges.reverse();
      // Geometry runs a → b; flip it when walking b → a, and drop the shared vertex between edges.
      const coords: LonLat[] = [];
      edges.forEach((e, i) => {
        const g = e.a === nodes[i] ? e.geometry : [...e.geometry].reverse();
        coords.push(...(i ? g.slice(1) : g));
      });
      if (!edges.length) {
        const n = graph.nodes.find((x) => x.id === from);
        if (n) coords.push([n.lon, n.lat]);
      }
      return { nodes, edges: edges.map((e) => e.id), coords };
    },

    summarize(r, slot) {
      let distance_m = 0;
      let sunMetres = 0;
      for (const id of r.edges) {
        const len = edgeById.get(id)?.length_m ?? 0;
        distance_m += len;
        sunMetres += len * sunAt(id, slot);
      }
      return {
        distance_m,
        walk_min: distance_m / WALK_SPEED_MS / 60,
        sun_min: sunMetres / WALK_SPEED_MS / 60,
      };
    },
  };
}

class MinHeap {
  private costs: number[] = [];
  private nodes: string[] = [];
  get size() { return this.costs.length; }

  push(cost: number, node: string) {
    const c = this.costs, n = this.nodes;
    let i = c.push(cost) - 1;
    n.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p]; n[i] = n[p];
      i = p;
    }
    c[i] = cost; n[i] = node;
  }

  pop(): [number, string] {
    const c = this.costs, n = this.nodes;
    const top: [number, string] = [c[0], n[0]];
    const cost = c.pop()!, node = n.pop()!;
    if (c.length) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= c.length) break;
        if (k + 1 < c.length && c[k + 1] < c[k]) k++;
        if (c[k] >= cost) break;
        c[i] = c[k]; n[i] = n[k];
        i = k;
      }
      c[i] = cost; n[i] = node;
    }
    return top;
  }
}
