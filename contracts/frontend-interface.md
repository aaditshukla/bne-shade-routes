# Frontend interface

What the web app loads, and the TypeScript surface other code may rely on. Eric owns everything in `web/`
except `web/public/data/`; Data owns the files described here. File formats are in `data-formats.md`;
decisions in `decisions.md`. Signatures below are the agreed seam: change the code freely behind them,
but changing a signature is a team decision.

## What the app loads

The app is static. It fetches **only** from `web/public/data/`, resolved through Vite's base URL, never a live API
and never a hard-coded `/data/...` path (Vercel serves at the root, but the base may change):

```ts
const url = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;   // BASE_URL ends with "/"
```

| File | When | Used for |
|---|---|---|
| `graph.json` | at start | routing, nearest node, venue (route origin, Q2) |
| `shade.json` | at start | `sunFraction[edgeId][slot]`, `sun[slot]` for the slider label |
| `shadows/HHMM.geojson` | per slot, on demand; prefetch neighbouring slots | 2D shadow overlay (Q1). If a file is missing or fails, colour street edges by `sunFraction` instead |
| `buildings.geojson`, `trees.geojson` | only when the 3D toggle opens | 3D view (stretch); never in the first load |

`awnings.json` is **not** loaded: verified awnings are already merged into `shade.json`.
Slot ↔ file name: slot `i` → minutes `360 + 15·i` → `HHMM` (slot 42 → `1630.geojson`). There is no file for slot 50 (`1830`).
Current slot: `clamp(round((minutesSinceMidnightBrisbane − 360) / 15), 0, 50)`, using UTC+10 regardless of the phone's timezone.

## Routing lives only in `web/src/routing/`

Nothing else implements shortest paths. Anything that needs routes (UI, 3D, `docs/find-demo-routes.ts`) imports from
`web/src/routing/`. Cost per edge: `length_m × (1 + α × sunFraction[edgeId][slot])`, α in `[0, 10]`; walking speed 1.3 m/s.

```ts
// web/src/routing/index.ts

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

export function createRouter(graph: Graph, shade: ShadeData): Router;
export function loadData(): Promise<{ graph: Graph; shade: ShadeData }>;   // fetches via BASE_URL as above
```

The results card compares `route(venue, dest, 0, slot)` (shortest) with `route(venue, dest, α, slot)` (shadiest, default α = 5);
extra minutes = `walk_min` difference, "% less sun" from `sun_min`. A route is recomputed in well under 100 ms.

## 3D (stretch): `web/src/three/` only

three.js is imported only inside `web/src/three/` and loaded with a dynamic `import()` when the 3D toggle opens
(laptop-only; hidden on touch devices).

```ts
// web/src/three/index.ts
import type { Graph, ShadeData, Route } from '../routing';

export interface ShadeViewData {
  bbox: Graph['bbox'];
  sun: ShadeData['sun'];                 // sun[slot] drives the DirectionalLight
  buildings: GeoJSON.FeatureCollection;  // buildings.geojson
  trees: GeoJSON.FeatureCollection;      // trees.geojson
}
export interface ShadeView {
  setSlot(slot: number): void;                                        // 0..50; moves the sun and its shadows
  showRoutes(routes: { shortest: Route; shadiest: Route } | null): void;   // null clears them
  dispose(): void;
}
export function createShadeView(el: HTMLElement, data: ShadeViewData): ShadeView;
```

Scene space: local metres from the bbox centre, **east = +X, up = +Y, north = −Z**. Direction toward the sun is
`(sin az·cos alt, sin alt, −cos az·cos alt)`. At 16:30 (alt ≈ 22.7°, az ≈ 258.5°) shadows must point ENE.
