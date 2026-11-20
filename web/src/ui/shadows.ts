// Shadow overlay files: shadows/HHMM.geojson, one per daytime slot (contract Q1). Fetched on demand and cached.
import type { FeatureCollection } from 'geojson';

const cache = new Map<string, Promise<FeatureCollection | null>>();

/** Shadows for a slot's "HH:MM" label, or null if the file is missing or fails (caller falls back). */
export function loadShadows(hhmm: string): Promise<FeatureCollection | null> {
  let p = cache.get(hhmm);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/shadows/${hhmm.replace(':', '')}.geojson`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null) // Vite dev serves index.html for a missing file, so .json() throws: also lands here
      .then((fc) => {
        if (!fc) cache.delete(hhmm); // let a flaky connection retry next time
        return fc;
      });
    cache.set(hhmm, p);
  }
  return p;
}
