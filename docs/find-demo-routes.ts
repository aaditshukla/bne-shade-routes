// P1: find the demo routes with the app's real router (no second router).
// Run from the repo root:  node --experimental-strip-types --no-warnings docs/find-demo-routes.ts
// Writes docs/demo-routes.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRouter, type Graph, type ShadeData } from '../web/src/routing/index.ts';

const ROOT = new URL('..', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const graph: Graph = read('web/public/data/graph.json');
const shade: ShadeData = read('web/public/data/shade.json');
const router = createRouter(graph, shade);

const ALPHA = 5;                     // app default
const SLOTS: Record<string, number> = { '09:00': 12, '12:00': 24, '16:30': 42 };
const MIN_M = 150, MAX_M = 500;      // straight-line distance from the venue
const MAX_DETOUR = 0.25;             // demo pairs: shady route adds under 25% at every time
const PRESET_DETOUR = 0.35;          // presets: under 35% at 2 or more of the 3 times
const EDGE_MARGIN_M = 30;            // keep destinations off the map border
const MIN_SPACING_M = 100;           // picks must be this far apart from each other

// Local metres around the venue (same approximation as the router's nearestNode).
const kx = 111_320 * Math.cos((graph.venue.lat * Math.PI) / 180);
const ky = 110_574;
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) =>
  Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * ky);

// Junction labels the app's search understands ("Ann Street & Brunswick Street").
const namesAt = new Map<string, Set<string>>();
for (const e of graph.edges) {
  if (!e.name) continue;
  for (const n of [e.a, e.b]) {
    if (!namesAt.has(n)) namesAt.set(n, new Set());
    namesAt.get(n)!.add(e.name);
  }
}
const edgeName = new Map(graph.edges.map((e) => [e.id, e.name ?? '']));

const [minLon, minLat, maxLon, maxLat] = graph.bbox;
const venue = graph.venue;

interface SlotResult {
  time: string;
  short: { m: number; sun: number };
  shady: { m: number; sun: number };
  saved: number;
  detour: number;
  differs: boolean;
  via: string;
}
interface Candidate { node: string; label: string; lon: number; lat: number; straight: number; slots: SlotResult[]; total: number; strict: boolean }

const viaStreets = (edges: string[], other: string[]) => {
  const mine = new Set(other);
  const names: string[] = [];
  for (const id of edges) {
    if (mine.has(id)) continue;
    const n = edgeName.get(id);
    if (n && names[names.length - 1] !== n) names.push(n);
  }
  return names.slice(0, 3).join(' > ') || 'unnamed footpaths or lanes';
};

const candidates: Candidate[] = [];
for (const n of graph.nodes) {
  const names = namesAt.get(n.id);
  if (!names || names.size < 2) continue;                       // named junctions only
  const straight = metres(n, venue);
  if (straight < MIN_M || straight > MAX_M) continue;
  const fromEdge = Math.min((n.lon - minLon) * kx, (maxLon - n.lon) * kx, (n.lat - minLat) * ky, (maxLat - n.lat) * ky);
  if (fromEdge < EDGE_MARGIN_M) continue;

  const slots: SlotResult[] = [];
  let ok = true;
  for (const [time, slot] of Object.entries(SLOTS)) {
    const s = router.route(venue.node, n.id, 0, slot);
    const h = router.route(venue.node, n.id, ALPHA, slot);
    if (!s || !h) { ok = false; break; }
    const ss = router.summarize(s, slot), hs = router.summarize(h, slot);
    const detour = hs.distance_m / ss.distance_m - 1;
    const differs = s.edges.join() !== h.edges.join();
    slots.push({
      time,
      short: { m: ss.distance_m, sun: ss.sun_min },
      shady: { m: hs.distance_m, sun: hs.sun_min },
      saved: ss.sun_min - hs.sun_min,
      detour,
      differs,
      via: differs ? viaStreets(h.edges, s.edges) : '(same as shortest)',
    });
  }
  if (!ok) continue;
  const strict = slots.every((r) => r.differs && r.detour < MAX_DETOUR);
  const good = slots.filter((r) => r.differs && r.detour < PRESET_DETOUR).length;
  if (!strict && good < 2) continue;
  const label = [...names].sort().slice(0, 2).join(' & ');
  candidates.push({ node: n.id, label, lon: n.lon, lat: n.lat, straight, slots, total: slots.reduce((a, r) => a + r.saved, 0), strict });
}

candidates.sort((a, b) => Number(b.strict) - Number(a.strict) || b.total - a.total);

// Greedy pick: best first, skipping anything too close to an earlier pick or with a repeated label.
const picks: Candidate[] = [];
for (const c of candidates) {
  if (picks.some((p) => metres(p, c) < MIN_SPACING_M || p.label === c.label)) continue;
  picks.push(c);
  if (picks.length === 5) break;
}

// Team choice (Sat 21 Nov): opener with the smallest detour, then the steadiest saver, then the
// biggest saver as the "maximum shade" example, accepting its +28% detour at 09:00 over the 25% rule.
const DEMO_ORDER = ['n_f677a08c', 'n_8e224ba7', 'n_9e615c5b'];
const demo = DEMO_ORDER.map((id) => candidates.find((c) => c.node === id)).filter((c): c is Candidate => !!c);
if (demo.length !== DEMO_ORDER.length) throw new Error('a chosen demo node no longer qualifies: rerun and re-pick');
const presets = [...demo, ...picks.filter((p) => !demo.includes(p))].slice(0, 5);

const f1 = (x: number) => x.toFixed(1);
const pct = (x: number) => `+${Math.round(x * 100)}%`;
const extraMin = (r: SlotResult) => (r.shady.m - r.short.m) / 1.3 / 60;

let md = `# Demo routes (P1)

Generated by \`docs/find-demo-routes.ts\` with the app's own router (\`web/src/routing/\`) on the real
\`graph.json\` + \`shade.json\` (buildings, trees and the 55 verified awnings). Origin is always the venue
(${venue.name}). Shadiest = alpha ${ALPHA}, the app default. Rerun after any data change:

\`\`\`sh
node --experimental-strip-types --no-warnings docs/find-demo-routes.ts
\`\`\`

Rules: named junctions ${MIN_M}–${MAX_M} m from the venue, at least ${EDGE_MARGIN_M} m inside the map edge; the
shadiest route must differ from the shortest at 09:00, 12:00 and 16:30 and add under ${MAX_DETOUR * 100}% distance
each time. Ranked by sun-minutes saved summed over the three times. ${candidates.filter((c) => c.strict).length} junctions pass
that rule; presets 4–5 may come from a looser tier (differs at 2+ times, under ${PRESET_DETOUR * 100}%) if needed.
Labels are typed exactly as the app's search finds them.

Pair 3 is a team choice outside the strict rule: the biggest saver, at +28% distance at 09:00.

## The 3 demo pairs
`;

demo.forEach((c, i) => {
  md += `\n### ${i + 1}. ${c.label}\n\n\`${c.node}\` · ${c.lon.toFixed(6)}, ${c.lat.toFixed(6)} · ${Math.round(c.straight)} m straight-line from the venue\n\n`;
  md += `| Time | Shortest | Shadiest | Sun-min saved | Extra walk | Shadiest goes via |\n|---|---|---|---|---|---|\n`;
  for (const r of c.slots)
    md += `| ${r.time} | ${Math.round(r.short.m)} m, ${f1(r.short.sun)} sun-min | ${Math.round(r.shady.m)} m, ${f1(r.shady.sun)} sun-min | ${f1(r.saved)} | ${pct(r.detour)}, ${f1(extraMin(r))} min | ${r.via} |\n`;
});

md += `\n## 5 preset destinations (for the presets)\n\n| # | Name | lon, lat | Node | Sun-min saved (09:00 / 12:00 / 16:30) |\n|---|---|---|---|---|\n`;
presets.forEach((c, i) => {
  md += `| ${i + 1} | ${c.label} | ${c.lon.toFixed(6)}, ${c.lat.toFixed(6)} | \`${c.node}\` | ${c.slots.map((r) => f1(r.saved)).join(' / ')} |\n`;
});

writeFileSync(new URL('docs/demo-routes.md', ROOT), md);
console.log(`${candidates.filter((c) => c.strict).length} strict + ${candidates.filter((c) => !c.strict).length} loose junctions; wrote docs/demo-routes.md`);
for (const c of presets) console.log(`  ${c.strict ? 'strict' : 'loose '} ${c.label}: saved ${c.slots.map((r) => f1(r.saved)).join(' / ')} sun-min, detour ${c.slots.map((r) => pct(r.detour)).join(' / ')}`);
