// Walking pace for the arrival estimate: the contract's 1.3 m/s until we have measured the walker.
import { WALK_SPEED_MS } from './shade.ts';

export function paceMs(walked_m: number, elapsed_s: number): number {
  if (walked_m < 30 || elapsed_s < 30) return WALK_SPEED_MS;
  return Math.max(0.8, Math.min(2, walked_m / elapsed_s));
}
