// Self-check: npm run check:nav (position sources)
import assert from 'node:assert/strict';
import { makeProjector, type Fix } from './geo.ts';
import { GeolocationSource, SimSource, type PositionErrorKind } from './position.ts';
import { advance, buildNavPath, hasArrived, type Progress } from './progress.ts';

const ORIGIN: [number, number] = [153.031522, -27.460061];
const proj = makeProjector(ORIGIN);
const nav = buildNavPath([[0, 0], [150, 0], [150, 100]].map((p) => proj.toLonLat(p as [number, number])), ORIGIN); // 250 m, one turn

// The simulated walker: first fix at the start, then one fix per step along the route, ending at the end.
{
  const t0 = Date.UTC(2026, 10, 20, 14, 0, 0); // 00:00 Brisbane on the 21st
  let tick: () => void = () => {};
  let cancelled = false;
  const sim = new SimSource(nav, { t0, speed: 1.4, mult: 1, jitter_m: 3, seed: 5, every: (fn) => ((tick = fn), () => (cancelled = true)) });
  const fixes: Fix[] = [];
  sim.start((f) => fixes.push(f));
  assert.equal(fixes.length, 1, 'reports the start straight away');
  assert.equal(fixes[0].t, t0);
  for (let i = 0; i < 400; i++) tick();
  assert.equal(fixes.length, 401);
  assert.equal(fixes[1].t - fixes[0].t, 1000);
  // Fed back through the snapper, the walk makes steady progress and ends in an arrival.
  let prog: Progress | null = null;
  let last = 0;
  for (const f of fixes) {
    prog = advance(nav, f, prog);
    assert.ok(prog.walked_m >= last);
    last = prog.walked_m;
  }
  assert.ok(hasArrived(prog!), `ends in an arrival (${prog!.remaining_m} m left)`);
  assert.ok(fixes.every((f) => f.accuracy_m >= 5 && f.accuracy_m <= 9));
  assert.equal(fixes[fixes.length - 1].speed, 0, 'stands still at the end');
  sim.stop();
  assert.ok(cancelled);
  // Time compression: 4× covers four times the ground per tick.
  const fast = new SimSource(nav, { t0, mult: 4, jitter_m: 0, every: (fn) => ((tick = fn), () => {}) });
  const ff: Fix[] = [];
  fast.start((f) => ff.push(f));
  tick();
  assert.equal(ff[1].t - ff[0].t, 4000);
  const p = proj.toXY([ff[1].lon, ff[1].lat]);
  assert.ok(Math.abs(p[0] - 1.4 * 4) < 0.01, 'moved 5.6 m east');
  // Same seed, same walk.
  const mk = () => {
    const out: Fix[] = [];
    let step: () => void = () => {};
    new SimSource(nav, { t0, seed: 9, every: (fn) => ((step = fn), () => {}) }).start((f) => out.push(f));
    step();
    return out;
  };
  assert.deepEqual(mk(), mk());
}

// The GPS source: maps a browser position to a Fix, and each error code to a kind the UI can show.
{
  let ok: (p: { coords: { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null }; timestamp: number }) => void = () => {};
  let err: (e: { code: number; message: string }) => void = () => {};
  let opts: unknown;
  let cleared: number | null = null;
  const src = new GeolocationSource({
    watchPosition: (o, e, op) => ((ok = o), (err = e), (opts = op), 7),
    clearWatch: (id) => (cleared = id),
  });
  const fixes: Fix[] = [];
  const errors: PositionErrorKind[] = [];
  src.start((f) => fixes.push(f), (k) => errors.push(k));
  assert.deepEqual(opts, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 });
  ok({ coords: { latitude: -27.46, longitude: 153.03, accuracy: 12, heading: 90, speed: 1.2 }, timestamp: 1234 });
  assert.deepEqual(fixes[0], { lon: 153.03, lat: -27.46, accuracy_m: 12, heading: 90, speed: 1.2, t: 1234 });
  err({ code: 1, message: '' });
  err({ code: 2, message: '' });
  err({ code: 3, message: '' });
  assert.deepEqual(errors, ['denied', 'unavailable', 'timeout']);
  src.stop();
  assert.equal(cleared, 7);
  // No geolocation at all (an old browser or a desktop without it): a final 'unsupported'.
  const none: PositionErrorKind[] = [];
  new GeolocationSource(undefined).start(() => {}, (k) => none.push(k));
  assert.deepEqual(none, ['unsupported']);
}

console.log('nav position self-check passed');
