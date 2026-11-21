// Scene-space maths for the 3D view, kept free of three.js so geo.check.ts can run in plain Node.
// Scene space (contract): local metres from the bbox centre, east = +X, up = +Y, north = −Z.

type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** [lon, lat] → [x, z] in metres. Equirectangular around the centre: well under 1% off across the bbox. */
export function localProjector(bbox: BBox) {
  const lon0 = (bbox[0] + bbox[2]) / 2;
  const lat0 = (bbox[1] + bbox[3]) / 2;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_574;
  return (p: number[]): [x: number, z: number] => [(p[0] - lon0) * kx, -(p[1] - lat0) * ky];
}

/** Unit vector from the ground toward the sun (contract formula). az is clockwise from true north. */
export function sunDirection(alt_deg: number, az_deg: number): [x: number, y: number, z: number] {
  const alt = (alt_deg * Math.PI) / 180;
  const az = (az_deg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)];
}
