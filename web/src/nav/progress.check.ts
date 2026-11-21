// Self-check: npm run check:nav (geometry + progress)
import assert from 'node:assert/strict';
import { angleDiff, bearing, bearingAt, buildPath, easeAngle, makeProjector, pointAt, pointToSegment, slicePath, type Fix, type XY } from './geo.ts';
import { advance, buildNavPath, hasArrived, type Progress } from './progress.ts';

const ORIGIN: [number, number] = [153.031522, -27.460061];
const proj = makeProjector(ORIGIN);
const near = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

// Seeded RNG, like route.check.ts.
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const route = (xy: XY[]) => buildNavPath(xy.map((p) => proj.toLonLat(p)), ORIGIN);
const fixAt = (p: XY, accuracy_m = 8, t = 0): Fix => {
  const [lon, lat] = proj.toLonLat(p);
  return { lon, lat, accuracy_m, t };
};

// --- geo ---
// Projection round-trips, and 0.001° of latitude is ~110.6 m.
const rt = proj.toLonLat(proj.toXY([153.0321, -27.4601]));
near(rt[0], 153.0321, 1e-9);
near(proj.toXY([ORIGIN[0], ORIGIN[1] + 0.001])[1], 110.574, 1e-6);
// Compass bearings: 0 N, 90 E, 180 S, 270 W. Latitude is negative here; north is still +y.
near(bearing([0, 0], [0, 10]), 0, 1e-9);
near(bearing([0, 0], [10, 0]), 90, 1e-9);
near(bearing([0, 0], [0, -10]), 180, 1e-9);
near(bearing([0, 0], [-10, 0]), 270, 1e-9);
// angleDiff: turning from north to east is +90 (right); wraps across north.
near(angleDiff(90, 0), 90, 1e-9);
near(angleDiff(350, 10), -20, 1e-9);
near(angleDiff(10, 350), 20, 1e-9);
near(Math.abs(angleDiff(180, 0)), 180, 1e-9);
near(easeAngle(350, 10, 0.5), 0, 1e-9);
// Closest point on a segment clamps to its ends.
assert.deepEqual(pointToSegment([5, 3], [0, 0], [10, 0]).at, [5, 0]);
near(pointToSegment([-4, 3], [0, 0], [10, 0]).d, 5, 1e-9);
// Path helpers.
const L = buildPath([[0, 0], [100, 0], [100, 100]]);
near(L.total, 200, 1e-9);
assert.deepEqual(pointAt(L, 150), [100, 50]);
near(bearingAt(L, 50), 90, 1e-9);
near(bearingAt(L, 150), 0, 1e-9);
near(bearingAt(L, 100), 45, 1e-9, 'at the corner the bearing looks both ways');
assert.deepEqual(slicePath(L, 50, 150), [[50, 0], [100, 0], [100, 50]]);

// --- progress: a straight 200 m street, walked with GPS noise ---
{
  const r = route([[0, 0], [200, 0]]);
  let prog: Progress | null = null;
  let last = 0;
  for (let s = 0; s <= 200; s += 1.4) {
    prog = advance(r, fixAt([s + gauss() * 4, gauss() * 4], 8), prog);
    assert.ok(prog.walked_m >= last, 'progress never goes backwards');
    last = prog.walked_m;
    near(prog.walked_m + prog.remaining_m, 200, 1e-6);
  }
  near(prog!.walked_m, 200, 12, 'ends near the end');
  assert.ok(hasArrived(prog!));
  near(bearingAt(r.path, 100), 90, 1e-9);
}

// --- an L-shaped route: along 100 m east, then 100 m north ---
{
  const r = route([[0, 0], [100, 0], [100, 100]]);
  let prog = advance(r, fixAt([20, 2]), null);
  near(prog.walked_m, 20, 1e-6);
  near(prog.off_m, 2, 0.05);
  near(prog.heading, 90, 1e-6);
  prog = advance(r, fixAt([80, -3]), prog);
  prog = advance(r, fixAt([103, 40]), prog);
  near(prog.walked_m, 140, 1e-6);
  near(prog.heading, 0, 1e-6);
  near(prog.off_m, 3, 0.05);
  // A fix 40 m off the street reports it.
  prog = advance(r, fixAt([60, 40]), prog);
  assert.ok(prog.off_m > 35, 'far from the route is reported as off it');
}

// --- a route that crosses itself: the second pass through the crossing must not snap back to the first ---
{
  // East along y=0, north, west along y=100, then south straight through the first leg at (50, 0) and on to y=-50.
  const r = route([[0, 0], [100, 0], [100, 100], [50, 100], [50, -50]]);
  const total = r.path.total; // 100 + 100 + 50 + 150
  near(total, 400, 1e-4);
  let prog: Progress | null = null;
  const walk = (xy: XY) => (prog = advance(r, fixAt(xy, 5), prog));
  for (let s = 0; s < total; s += 5) {
    walk(pointAt(r.path, s));
    near(prog!.walked_m, s, 1.5, `walking at ${s} m`);
  }
  // Specifically at the crossing, the second time.
  near(advance(r, fixAt([50, 0], 5), advance(r, fixAt([50, 30], 5), advance(r, fixAt([50, 60], 5), advance(r, fixAt([50, 90], 5), { ...prog!, walked_m: 255, remaining_m: 145 })))).walked_m, 350, 6);
}

// --- a route that runs alongside itself 10 m apart (a U): walking the outbound line must not jump to the return line ---
{
  const r = route([[0, 0], [150, 0], [150, 10], [0, 10]]);
  let prog: Progress | null = null;
  for (let s = 0; s <= 150; s += 2) {
    prog = advance(r, fixAt([s, gauss() * 1.5], 6), prog);
    near(prog.walked_m, s, 6, `outbound at ${s} m`);
  }
  // Then the turn and the way back, with the same jitter.
  for (let x = 150; x >= 0; x -= 2) {
    prog = advance(r, fixAt([x, 10 + gauss() * 1.5], 6), prog);
    near(prog.walked_m, 160 + (150 - x), 6, `return at x=${x}`);
  }
}

// --- a fuzzy fix moves the dot's position estimate but never progress ---
{
  const r = route([[0, 0], [200, 0]]);
  let prog = advance(r, fixAt([50, 0], 5), null);
  const fuzzy = advance(r, fixAt([120, 0], 90), prog);
  assert.equal(fuzzy.walked_m, prog.walked_m);
  assert.equal(fuzzy.accurate, false);
  assert.ok(!hasArrived(advance(r, fixAt([200, 0], 90), prog)), 'a fuzzy fix at the end is not an arrival');
  prog = advance(r, fixAt([120, 0], 10), prog);
  near(prog.walked_m, 120, 1e-6);
}

// --- a one-point route (origin = destination) doesn't throw ---
{
  const r = route([[0, 0]]);
  const prog = advance(r, fixAt([3, 4]), null);
  assert.equal(prog.walked_m, 0);
  near(prog.off_m, 5, 0.05);
}

console.log('nav progress self-check passed');
