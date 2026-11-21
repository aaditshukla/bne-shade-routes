// Plane geometry for navigation, in local metres. No DOM, no map library, so the checks run in plain Node.
// Coordinates are [lon, lat] everywhere outside this file; inside, [x, y] metres with x = east, y = north.

export type LonLat = [lon: number, lat: number];
export type XY = [x: number, y: number];

/** A position report: from the phone's GPS or from the simulated walker. `t` is epoch milliseconds. */
export interface Fix {
  lon: number;
  lat: number;
  accuracy_m: number;
  heading?: number | null; // degrees clockwise from true north, when the device knows it
  speed?: number | null; // m/s
  t: number;
}

export interface Projector {
  toXY(p: LonLat): XY;
  toLonLat(p: XY): LonLat;
}

/** Same scaling the router uses (lon scaled by cos(lat)): well under 1% off across the 600 m bbox. */
export function makeProjector(origin: LonLat): Projector {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  const ky = 110_574;
  return {
    toXY: (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLonLat: (p) => [origin[0] + p[0] / kx, origin[1] + p[1] / ky],
  };
}

/** Bearing in degrees clockwise from north (0 N, 90 E, 180 S, 270 W) of the vector from a to b. */
export function bearing(a: XY, b: XY): number {
  return (((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI) + 360) % 360;
}

/** Signed difference a − b wrapped into (−180, 180]; positive means a is clockwise of b. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Moves an angle toward a target along the short way, by a fraction k of the gap. */
export function easeAngle(from: number, to: number, k: number): number {
  return (from + angleDiff(to, from) * k + 360) % 360;
}

export const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Closest point to p on segment a–b: `t` in [0, 1] along it, `d` the distance, `at` the point. */
export function pointToSegment(p: XY, a: XY, b: XY): { t: number; d: number; at: XY } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
  const at: XY = [a[0] + vx * t, a[1] + vy * t];
  return { t, d: dist(p, at), at };
}

/** A polyline in metres with cumulative distances, so any distance along it maps to a point and a bearing. */
export interface Path {
  pts: XY[];
  cum: number[]; // cum[i] = metres from the start to pts[i]
  total: number;
}

export function buildPath(pts: XY[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] ?? 0 };
}

/** Index of the segment containing distance s (segment i runs pts[i] → pts[i + 1]). */
export function segmentAt(path: Path, s: number): number {
  const n = path.pts.length - 2;
  if (n < 0) return 0;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path.cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The point s metres along the path (clamped to its ends). */
export function pointAt(path: Path, s: number): XY {
  if (path.pts.length === 1) return path.pts[0];
  const c = Math.max(0, Math.min(path.total, s));
  const i = segmentAt(path, c);
  const len = path.cum[i + 1] - path.cum[i];
  const t = len === 0 ? 0 : (c - path.cum[i]) / len;
  const a = path.pts[i];
  const b = path.pts[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Direction of travel at s, looking `span` metres around it so a vertex or a 2 m edge doesn't swing it. */
export function bearingAt(path: Path, s: number, span = 8): number {
  if (path.pts.length < 2 || path.total === 0) return 0;
  const a = pointAt(path, s - span / 2);
  const b = pointAt(path, s + span / 2);
  return dist(a, b) < 1e-6 ? bearing(path.pts[0], path.pts[path.pts.length - 1]) : bearing(a, b);
}

/** The part of the path between two distances, as points (for the walked and still-to-walk lines). */
export function slicePath(path: Path, from: number, to: number): XY[] {
  const a = Math.max(0, Math.min(path.total, from));
  const b = Math.max(a, Math.min(path.total, to));
  const out: XY[] = [pointAt(path, a)];
  for (let i = 0; i < path.pts.length; i++) if (path.cum[i] > a && path.cum[i] < b) out.push(path.pts[i]);
  out.push(pointAt(path, b));
  return out;
}
