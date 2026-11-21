// Self-check: npm run check:nav (shade guidance, off-route, pace)
import assert from 'node:assert/strict';
import type { Leg } from './legs.ts';
import { OffRouteMonitor } from './offroute.ts';
import { paceMs } from './pace.ts';
import { describeShade, remainingSunMin, shadeAhead, sunRuns, worthSwitching } from './shade.ts';

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// Four 100 m legs: sun, shade, shade, sun (sun fractions 1, 0, 0.2, 0.8).
const SUN: Record<string, number> = { a: 1, b: 0, c: 0.2, d: 0.8 };
const legs: Leg[] = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, from: `n${i}`, to: `n${i + 1}`, start_m: i * 100, end_m: i * 100 + 100, length_m: 100 }));
const sunOf = (l: Leg) => SUN[l.id];

// Remaining sun: at the start it equals the contract total; halfway through leg a it loses half of a's sun.
const total = (100 * 1 + 0 + 100 * 0.2 + 100 * 0.8) / 1.3 / 60;
near(remainingSunMin(legs, 0, sunOf), total);
near(remainingSunMin(legs, 50, sunOf), total - 50 / 1.3 / 60);
near(remainingSunMin(legs, 200, sunOf), (100 * 0.2 + 100 * 0.8) / 1.3 / 60); // legs c and d are still ahead
near(remainingSunMin(legs, 400, sunOf), 0);
// Missing data counts as full sun.
near(remainingSunMin(legs, 0, () => 1), 400 / 1.3 / 60);

// The strip's runs add up to the route length, and the sunny ones to the sun minutes.
const runs = sunRuns(legs, sunOf);
near(runs.reduce((s, r) => s + r.m, 0), 400);
near(runs.filter((r) => r.sun).reduce((s, r) => s + r.m, 0) / 1.3 / 60, total);

// Shade ahead: in the sun at 50 m, the shade starts at 100 m; in shade at 150 m until 300 m; sun to the end after that.
assert.deepEqual(shadeAhead(legs, 50, sunOf), { now: 'sun', until_m: 50 });
assert.deepEqual(shadeAhead(legs, 150, sunOf), { now: 'shade', until_m: 150 }); // c is 0.2 sun: still counts as shade
assert.deepEqual(shadeAhead(legs, 350, sunOf), { now: 'sun', until_m: null });
assert.deepEqual(shadeAhead(legs, 999, sunOf), { now: 'sun', until_m: null }, 'past the end is the last leg');
assert.equal(shadeAhead([], 0, sunOf), null);
assert.equal(describeShade(shadeAhead(legs, 50, sunOf)), 'Shade in 50 m');
assert.equal(describeShade(shadeAhead(legs, 150, sunOf)), 'In shade for the next 150 m');
assert.equal(describeShade(shadeAhead(legs, 350, sunOf)), 'Sun for the rest of the way');
assert.equal(describeShade(shadeAhead(legs, 0, () => 0)), 'Shade all the way');
assert.equal(describeShade(null), null);

// Off-route: one outlier doesn't trigger it; a real wrong turn does, within a few fixes.
{
  const m = new OffRouteMonitor();
  let t = 0;
  const tick = (off_m: number, accuracy_m = 8) => m.update({ off_m, accuracy_m, t: (t += 1000) });
  assert.equal(tick(3), 'on');
  assert.equal(tick(60), 'suspect', 'a single outlier');
  assert.equal(tick(4), 'on', 'and it is forgotten');
  assert.equal(tick(40), 'suspect');
  assert.equal(tick(45), 'suspect');
  assert.equal(tick(50), 'suspect', 'three far fixes, but only 2 s of them');
  assert.equal(tick(50), 'suspect');
  assert.equal(tick(55), 'off', 'a real wrong turn: four seconds of being far away');
}
{
  const m = new OffRouteMonitor();
  let t = 0;
  const tick = (off_m: number, accuracy_m = 8, dt = 1000) => m.update({ off_m, accuracy_m, t: (t += dt) });
  tick(40); tick(40);
  assert.equal(tick(40), 'suspect', 'three fixes inside 2 s are not enough time');
  assert.equal(tick(40), 'suspect', '3 s is still not enough');
  assert.equal(tick(40), 'off', '4 s of being far away is');
}
// The threshold grows with the fix's own accuracy: 30 m off with ±40 m accuracy is within the noise.
{
  const m = new OffRouteMonitor();
  let t = 0;
  for (let i = 0; i < 10; i++) assert.equal(m.update({ off_m: 30, accuracy_m: 40, t: (t += 1000) }), 'on');
  // Fuzzy fixes (over 80 m) tell us nothing either way.
  assert.equal(m.update({ off_m: 500, accuracy_m: 120, t: (t += 1000) }), 'on');
}
// After a reroute it stays quiet for the cooldown, then can trigger again (no loop).
{
  const m = new OffRouteMonitor({ cooldown_ms: 10_000 });
  m.reset(0);
  for (let t = 1000; t <= 9000; t += 1000) assert.equal(m.update({ off_m: 80, accuracy_m: 8, t }), 'on', `quiet at ${t}`);
  let state = 'on';
  for (let t = 10_000; t <= 16_000 && state !== 'off'; t += 1000) state = m.update({ off_m: 80, accuracy_m: 8, t });
  assert.equal(state, 'off');
}

// Pace: 1.3 m/s until there is something to measure, then the walker's own, within sane bounds.
near(paceMs(10, 10), 1.3);
near(paceMs(100, 60), 100 / 60);
near(paceMs(500, 100), 2);
near(paceMs(40, 100), 0.8);

// Offering a shadier way mid-walk: a real saving, without a long detour.
assert.ok(worthSwitching({ sun_min: 2, walk_min: 5 }, { sun_min: 1.5, walk_min: 6 }));
assert.ok(!worthSwitching({ sun_min: 2, walk_min: 5 }, { sun_min: 1.8, walk_min: 5 }), 'too small a saving');
assert.ok(!worthSwitching({ sun_min: 2, walk_min: 5 }, { sun_min: 0.5, walk_min: 7 }), 'too long a detour');

console.log('nav guidance self-check passed');
