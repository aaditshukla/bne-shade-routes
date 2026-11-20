// Shade-aware routing. Everything else imports routes from here (CLAUDE.md).
// shortcut: these input types are a guess until contracts/frontend-interface.md exists; adapt them at 9:30.

export type Edge = { id: string; u: string; v: string; length_m: number };
/** edge id → sunFraction per slot (0 = full shade, 1 = full sun). */
export type SunFractions = Record<string, number[]>;
export type Graph = Map<string, { to: string; edge: Edge }[]>;
export type Route = { nodes: string[]; edges: Edge[] };

const WALK_SPEED_MS = 1.3;

/** Undirected adjacency list. Build once per graph.json. */
export function buildGraph(edges: Edge[]): Graph {
  const g: Graph = new Map();
  const add = (a: string, b: string, edge: Edge) => {
    let list = g.get(a);
    if (!list) g.set(a, (list = []));
    list.push({ to: b, edge });
  };
  for (const e of edges) {
    add(e.u, e.v, e);
    add(e.v, e.u, e);
  }
  return g;
}

// Missing data counts as full sun, so a gap never looks shadier than it is.
const sunAt = (sun: SunFractions, id: string, slot: number) => sun[id]?.[slot] ?? 1;

/** Dijkstra with cost length_m × (1 + α × sunFraction[slot]). α = 0 is the shortest route. */
export function route(
  g: Graph, sun: SunFractions, from: string, to: string, alpha: number, slot: number,
): Route | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { node: string; edge: Edge }>();
  const heap = new MinHeap();
  heap.push(0, from);

  while (heap.size) {
    const [d, node] = heap.pop();
    if (node === to) break;
    if (d > dist.get(node)!) continue; // stale heap entry
    for (const { to: next, edge } of g.get(node) ?? []) {
      const nd = d + edge.length_m * (1 + alpha * sunAt(sun, edge.id, slot));
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, { node, edge });
        heap.push(nd, next);
      }
    }
  }

  if (!dist.has(to)) return null;
  const nodes = [to];
  const edges: Edge[] = [];
  for (let n = to; n !== from; ) {
    const p = prev.get(n)!;
    edges.push(p.edge);
    nodes.push((n = p.node));
  }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}

/** Distance and minutes in the sun: Σ length_m × sunFraction / 1.3 / 60. */
export function summary(r: Route, sun: SunFractions, slot: number) {
  let distance_m = 0;
  let sunMetres = 0;
  for (const e of r.edges) {
    distance_m += e.length_m;
    sunMetres += e.length_m * sunAt(sun, e.id, slot);
  }
  return { distance_m, sunMinutes: sunMetres / WALK_SPEED_MS / 60 };
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
