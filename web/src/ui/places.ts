import type { Graph } from '../routing/index.ts';

export interface Place { label: string; node: string }

// Searchable places from the graph's own street names: the venue, every named street and every junction.
// shortcut: no addresses or businesses (needs a live geocoder, and the app is static); add a prebuilt POI file if the team wants one.
export function buildPlaces(graph: Graph): Place[] {
  const at = new Map(graph.nodes.map((n) => [n.id, n]));
  const namesAt = new Map<string, Set<string>>();
  const nodesOf = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!e.name) continue;
    for (const n of [e.a, e.b]) {
      if (!namesAt.has(n)) namesAt.set(n, new Set());
      namesAt.get(n)!.add(e.name);
      if (!nodesOf.has(e.name)) nodesOf.set(e.name, new Set());
      nodesOf.get(e.name)!.add(n);
    }
  }

  const places: Place[] = [{ label: 'Tanda HQ (venue)', node: graph.venue.node }];
  // A street is its node closest to the street's middle, so the pin lands on that street.
  for (const [name, ids] of [...nodesOf].sort(([a], [b]) => a.localeCompare(b))) {
    const pts = [...ids].map((id) => at.get(id)!);
    const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const mid = pts.reduce((b, p) => ((p.lon - lon) ** 2 + (p.lat - lat) ** 2 < (b.lon - lon) ** 2 + (b.lat - lat) ** 2 ? p : b));
    places.push({ label: name, node: mid.id });
  }
  const seen = new Set<string>();
  for (const [node, names] of namesAt) {
    const sorted = [...names].sort();
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const label = `${sorted[i]} & ${sorted[j]}`;
        if (seen.has(label)) continue; // a dual carriageway meets a street twice; keep the first
        seen.add(label);
        places.push({ label, node });
      }
  }
  return places;
}

// Every word typed must start a word in the label, in any order: "ann bruns" finds "Ann Street & Brunswick Street".
export function searchPlaces(places: Place[], query: string, limit = 6): Place[] {
  const words = query.toLowerCase().split(/[\s&()]+/).filter(Boolean);
  if (!words.length) return [];
  return places
    .filter((p) => {
      const lw = p.label.toLowerCase().split(/[\s&()]+/);
      return words.every((w) => lw.some((l) => l.startsWith(w)));
    })
    .slice(0, limit);
}
