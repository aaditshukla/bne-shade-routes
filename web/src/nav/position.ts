// Where is the walker? Two sources behind one interface: the phone's GPS, and a simulated walker that
// replays a route (`?sim`), so the demo works from a desk and the logic can be tested without moving.
import { bearingAt, pointAt, type Fix } from './geo.ts';
import type { NavPath } from './progress.ts';

export type PositionErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export interface PositionSource {
  /** Begin reporting. Errors with kind 'denied' or 'unsupported' are final; 'timeout' and 'unavailable' may recover. */
  start(onFix: (fix: Fix) => void, onError: (kind: PositionErrorKind, message: string) => void): void;
  stop(): void;
}

/** The part of the browser's Geolocation API we use, so a check can hand in a stand-in. */
interface GeoLike {
  watchPosition(
    ok: (p: { coords: { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null }; timestamp: number }) => void,
    err: (e: { code: number; message: string }) => void,
    opts?: { enableHighAccuracy?: boolean; maximumAge?: number; timeout?: number },
  ): number;
  clearWatch(id: number): void;
}

export class GeolocationSource implements PositionSource {
  private geo: GeoLike | undefined;
  private watchId: number | null = null;
  constructor(geo?: GeoLike) {
    this.geo = geo ?? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined);
  }

  start(onFix: (fix: Fix) => void, onError: (kind: PositionErrorKind, message: string) => void) {
    if (!this.geo) return onError('unsupported', "This browser can't share your location.");
    this.watchId = this.geo.watchPosition(
      (p) =>
        onFix({
          lon: p.coords.longitude,
          lat: p.coords.latitude,
          accuracy_m: p.coords.accuracy,
          heading: p.coords.heading,
          speed: p.coords.speed,
          t: p.timestamp,
        }),
      (e) => {
        // GeolocationPositionError codes: 1 permission denied, 2 position unavailable, 3 timeout.
        if (e.code === 1) onError('denied', 'Location is turned off for this site. Allow it in your browser settings, then try again.');
        else if (e.code === 3) onError('timeout', "Can't find you yet. Try moving to open sky.");
        else onError('unavailable', "Can't get your location right now.");
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
    );
  }

  stop() {
    if (this.watchId != null) this.geo?.clearWatch(this.watchId);
    this.watchId = null;
  }
}

export interface SimOptions {
  t0: number; // epoch ms of the first fix (the clock the walk runs on)
  speed?: number; // m/s, default 1.4
  mult?: number; // time compression: 4 = four seconds of walking per real second
  jitter_m?: number; // standard deviation of the position noise, default 3
  seed?: number;
  /** Test hook: replace the 1 s timer. Returns a function that cancels it. */
  every?: (fn: () => void, ms: number) => () => void;
}

/** Walks the route from its start to its end with GPS-like noise, one fix per real second. */
export class SimSource implements PositionSource {
  private s = 0;
  private t: number;
  private seed: number;
  private cancel: (() => void) | null = null;
  private onFix: ((fix: Fix) => void) | null = null;
  private opts: Required<Omit<SimOptions, 'every' | 't0' | 'seed'>> & Pick<SimOptions, 'every'>;
  private nav: NavPath;
  constructor(nav: NavPath, o: SimOptions) {
    this.nav = nav;
    this.t = o.t0;
    this.seed = o.seed ?? 1;
    this.opts = { speed: o.speed ?? 1.4, mult: o.mult ?? 1, jitter_m: o.jitter_m ?? 3, every: o.every };
  }

  private rand() {
    return (this.seed = (this.seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  }
  private gauss() {
    return Math.sqrt(-2 * Math.log(this.rand() + 1e-12)) * Math.cos(2 * Math.PI * this.rand());
  }

  /** The fix at the current spot on the route. */
  emit() {
    const { path, proj } = this.nav;
    const [x, y] = pointAt(path, this.s);
    const j = this.opts.jitter_m;
    const [lon, lat] = proj.toLonLat([x + this.gauss() * j, y + this.gauss() * j]);
    this.onFix?.({
      lon,
      lat,
      accuracy_m: 5 + this.rand() * 4,
      heading: bearingAt(path, this.s),
      speed: this.s < path.total ? this.opts.speed : 0,
      t: this.t,
    });
  }

  /** Advance the walker by `seconds` of walking time and report where it is. */
  step(seconds: number) {
    this.s = Math.min(this.nav.path.total, this.s + this.opts.speed * seconds);
    this.t += seconds * 1000;
    this.emit();
  }

  start(onFix: (fix: Fix) => void) {
    this.onFix = onFix;
    this.emit();
    const every = this.opts.every ?? ((fn, ms) => {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    });
    this.cancel = every(() => this.step(this.opts.mult), 1000);
  }

  stop() {
    this.cancel?.();
    this.cancel = null;
    this.onFix = null;
  }
}

/**
 * Keeps the screen on while navigating (a phone that sleeps stops reporting GPS in the browser). Re-acquires
 * the lock when the page comes back to the front. Quietly does nothing where the browser has no wake lock.
 * Returns the function that lets the screen sleep again.
 */
export function keepAwake(): () => void {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || typeof document === 'undefined') return () => {};
  let sentinel: WakeLockSentinel | null = null;
  let wanted = true;
  const acquire = () => {
    if (!wanted || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(
      (s) => {
        if (wanted) sentinel = s;
        else void s.release();
      },
      () => {}, // refused (low battery, etc.): carry on
    );
  };
  document.addEventListener('visibilitychange', acquire);
  acquire();
  return () => {
    wanted = false;
    document.removeEventListener('visibilitychange', acquire);
    sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
