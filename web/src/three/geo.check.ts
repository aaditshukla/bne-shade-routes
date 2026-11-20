// Self-check: npm run check:three
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localProjector, sunDirection } from './geo.ts';
import type { ShadeData } from '../routing/index.ts';

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

// Axes: sun due east at the horizon is +X, due north is −Z, overhead is +Y.
const east = sunDirection(0, 90);
near(east[0], 1); near(east[1], 0); near(east[2], 0);
const north = sunDirection(0, 0);
near(north[0], 0); near(north[2], -1);
near(sunDirection(90, 123)[1], 1);

// 16:30 on the demo date (alt ≈ 22.7°, az ≈ 258.5°), from the contract and from shade.json: shadows point ENE.
// The shadow runs along −dir on the ground, i.e. (−x, −z); with north = −Z its northward part is z.
const shade: ShadeData = JSON.parse(readFileSync(new URL('../../public/data/shade.json', import.meta.url), 'utf8'));
for (const [alt, az] of [[22.7, 258.5], [shade.sun[42].alt_deg, shade.sun[42].az_deg]]) {
  const [x, , z] = sunDirection(alt, az);
  assert.ok(-x > 0 && z > 0 && -x > 2 * z, `16:30 shadow not ENE: ${[x, z]}`);
}

// Projection: centre → origin; 0.001° north of centre is ≈ 110.6 m along −Z; east is +X.
const bbox: [number, number, number, number] = [153.02849, -27.46277, 153.03455, -27.45735];
const toXZ = localProjector(bbox);
const c = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
near(toXZ(c)[0], 0); near(toXZ(c)[1], 0);
near(toXZ([c[0], c[1] + 0.001])[1], -110.574, 1e-6);
assert.ok(toXZ([c[0] + 0.001, c[1]])[0] > 98 && toXZ([c[0] + 0.001, c[1]])[0] < 99.5);
// Bbox is about 600 × 600 m.
const [w] = toXZ([bbox[0], c[1]]), [e] = toXZ([bbox[2], c[1]]);
assert.ok(Math.abs(e - w - 598) < 5, `bbox width ${e - w}`);

console.log('3D geometry self-check passed');
