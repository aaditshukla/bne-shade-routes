// Shade guidance for a walk in progress: the sun still to come, and what the next stretch looks like.
// Everything comes from the same per-edge sunFraction the results card uses; nothing is invented here.
import type { Leg } from './legs.ts';

export const WALK_SPEED_MS = 1.3; // contract: sun minutes = Σ length_m × sunFraction / 1.3 / 60
/** A street counts as "sun" for guidance when at least half of it is sunny. */
export const SUNNY_AT = 0.5;

/** sun fraction of a leg, 0 = full shade; missing data counts as full sun (like the router). */
export type SunOf = (leg: Leg) => number;

/** Minutes in the sun still to walk from distance s: the contract formula over the part of each leg left. */
export function remainingSunMin(legs: Leg[], s: number, sunOf: SunOf): number {
  let metres = 0;
  for (const l of legs) {
    const span = l.end_m - l.start_m;
    const left = span <= 0 ? (s < l.end_m ? 1 : 0) : Math.max(0, Math.min(1, (l.end_m - Math.max(s, l.start_m)) / span));
    metres += l.length_m * sunOf(l) * left;
  }
  return metres / WALK_SPEED_MS / 60;
}

/** The whole route as runs of shade and sun in contract metres, so the strip's amber adds up to the sun minutes. */
export function sunRuns(legs: Leg[], sunOf: SunOf): { sun: boolean; m: number }[] {
  const runs: { sun: boolean; m: number }[] = [];
  for (const l of legs) {
    const f = sunOf(l);
    for (const [sun, m] of [[false, l.length_m * (1 - f)], [true, l.length_m * f]] as const) {
      if (m <= 0) continue;
      const last = runs[runs.length - 1];
      if (last?.sun === sun) last.m += m;
      else runs.push({ sun, m });
    }
  }
  return runs;
}

export interface ShadeAhead {
  now: 'sun' | 'shade';
  /** Metres until the current stretch changes to the other kind, or null if it lasts to the end. */
  until_m: number | null;
}

/** Is the walker in sun or shade now, and how far until that changes? */
export function shadeAhead(legs: Leg[], s: number, sunOf: SunOf): ShadeAhead | null {
  if (!legs.length) return null;
  const sunny = (l: Leg) => sunOf(l) >= SUNNY_AT;
  let i = legs.findIndex((l) => s < l.end_m);
  if (i < 0) i = legs.length - 1;
  const now = sunny(legs[i]);
  let j = i;
  while (j + 1 < legs.length && sunny(legs[j + 1]) === now) j++;
  return { now: now ? 'sun' : 'shade', until_m: j + 1 < legs.length ? Math.max(0, legs[j].end_m - s) : null };
}

const roundTo = (m: number) => (m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50);

/** "Shade in 40 m", "Shade for the next 120 m", "Sun for the rest of the way"; null when there is nothing to say. */
export function describeShade(a: ShadeAhead | null): string | null {
  if (!a) return null;
  if (a.now === 'sun') return a.until_m == null ? 'Sun for the rest of the way' : `Shade in ${roundTo(a.until_m)} m`;
  return a.until_m == null ? 'Shade all the way' : `In shade for the next ${roundTo(a.until_m)} m`;
}
