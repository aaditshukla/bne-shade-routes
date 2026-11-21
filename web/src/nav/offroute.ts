// Has the walker really left the route, or is that one bad GPS fix? Counts consecutive far-off fixes, so a
// single outlier in a street canyon doesn't trigger a reroute, and holds off after a reroute so it can't loop.

export type RouteState = 'on' | 'suspect' | 'off';

export interface OffRouteOptions {
  min_off_m?: number; // never call it off-route closer than this
  accuracy_factor?: number; // ...or closer than this many times the fix's own accuracy
  fixes?: number; // consecutive far-off fixes needed
  min_span_ms?: number; // ...spread over at least this long
  cooldown_ms?: number; // quiet period after a reroute
  ignore_accuracy_m?: number; // fixes fuzzier than this tell us nothing
}

export class OffRouteMonitor {
  private o: Required<OffRouteOptions>;
  private count = 0;
  private since = 0;
  private quietUntil = 0;
  constructor(opts: OffRouteOptions = {}) {
    this.o = { min_off_m: 25, accuracy_factor: 1.5, fixes: 3, min_span_ms: 4000, cooldown_ms: 10_000, ignore_accuracy_m: 80, ...opts };
  }

  update(fix: { off_m: number; accuracy_m: number; t: number }): RouteState {
    if (fix.t < this.quietUntil) return 'on';
    if (fix.accuracy_m > this.o.ignore_accuracy_m) return this.count ? 'suspect' : 'on';
    if (fix.off_m <= Math.max(this.o.min_off_m, this.o.accuracy_factor * fix.accuracy_m)) {
      this.count = 0;
      return 'on';
    }
    if (this.count === 0) this.since = fix.t;
    this.count++;
    return this.count >= this.o.fixes && fix.t - this.since >= this.o.min_span_ms ? 'off' : 'suspect';
  }

  /** Call after a reroute (or a new route): forget the streak and stay quiet for the cooldown. */
  reset(t: number) {
    this.count = 0;
    this.quietUntil = t + this.o.cooldown_ms;
  }
}
