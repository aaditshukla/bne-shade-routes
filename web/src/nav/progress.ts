// Where along the route is the walker? Snaps each GPS fix to the route polyline and reports metres walked,
// metres left and how far off the route the fix is. Pure functions: no DOM, no map library.
import { bearingAt, buildPath, dist, makeProjector, pointAt, pointToSegment, type Fix, type LonLat, type Path, type Projector } from './geo.ts';

/** A route ready for tracking: its polyline in local metres, plus the projector that made it. */
export interface NavPath {
  path: Path;
  proj: Projector;
}

export function buildNavPath(coords: LonLat[], origin: LonLat): NavPath {
  const proj = makeProjector(origin);
  return { path: buildPath(coords.map((c) => proj.toXY(c))), proj };
}

export interface Progress {
  walked_m: number; // metres along the route (never goes backwards)
  remaining_m: number;
  off_m: number; // distance from the fix to the nearest route point inside the search window
  snapped: LonLat; // the dot's position on the route
  heading: number; // direction of travel along the route here, degrees clockwise from north
  accurate: boolean; // false when the fix was too fuzzy to move progress
}

export const MAX_ACCURACY_M = 50; // fixes fuzzier than this move nothing
const BACK_M = 15; // how far behind the last position a fix may snap (for the off-route distance)
const AHEAD_M = 60; // how far ahead of the last position a fix may snap, before adding its accuracy

/**
 * Snap one fix. The search is limited to a window around the previous position, and progress only moves
 * forward, so a route that doubles back or runs alongside itself can't snap to the wrong stretch.
 * `prev` is null for the first fix, which searches from the start of the route.
 */
export function advance(nav: NavPath, fix: Fix, prev: Progress | null): Progress {
  const { path, proj } = nav;
  const p = proj.toXY([fix.lon, fix.lat]);
  const prevS = prev?.walked_m ?? 0;
  const accurate = fix.accuracy_m <= MAX_ACCURACY_M;
  const lo = prevS - BACK_M;
  const hi = prevS + AHEAD_M + Math.min(fix.accuracy_m, 100);

  let best = { s: prevS, d: Infinity };
  let bestScore = Infinity;
  for (let i = 0; i + 1 < path.pts.length; i++) {
    if (path.cum[i + 1] < lo || path.cum[i] > hi) continue;
    const seg = pointToSegment(p, path.pts[i], path.pts[i + 1]);
    const s = path.cum[i] + seg.t * (path.cum[i + 1] - path.cum[i]);
    // A hair of preference for the forward side when two stretches are equally near.
    const score = seg.d + (s < prevS ? 0.25 * (prevS - s) : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { s, d: seg.d };
    }
  }
  if (!isFinite(best.d)) best = { s: prevS, d: dist(p, pointAt(path, prevS)) }; // nothing in the window (single-point route)

  const walked_m = accurate ? Math.min(path.total, Math.max(prevS, best.s)) : prevS;
  return {
    walked_m,
    remaining_m: path.total - walked_m,
    off_m: best.d,
    snapped: proj.toLonLat(pointAt(path, walked_m)),
    heading: bearingAt(path, walked_m),
    accurate,
  };
}

/** Within about 15 m of the end, on a usable fix. */
export const ARRIVE_M = 15;
export const hasArrived = (p: Progress) => p.accurate && p.remaining_m <= ARRIVE_M;
