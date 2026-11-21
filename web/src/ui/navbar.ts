// The walking UI: instruction banner on top, trip bar at the bottom, recenter button and toast.
// Elements live in index.html; this file only fills them in. It knows nothing about maps or routing.
import type { ManeuverKind } from '../nav/maneuvers.ts';

export interface BannerState {
  icon: 'turn' | 'pin' | 'search' | 'warn';
  angle?: number; // for 'turn': degrees clockwise from straight ahead (positive = right)
  dist?: string; // "80 m"
  instr: string;
  sub?: string;
  warn?: boolean;
}
export interface Stats { arrive: string; left: string; sun: string }
export interface Summary { line: string; sun: string }

/** Distance as a person says it: "85 m", "1.2 km". */
export function fmtDist(m: number): string {
  if (m >= 950) return `${(m / 1000).toFixed(1)} km`;
  return `${m < 100 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 10) * 10} m`;
}

/** The arrow for a maneuver: an up arrow turned by the angle, so slight, sharp and U-turns look right. */
export function iconAngle(kind: ManeuverKind, angle: number): number {
  if (kind === 'depart' || kind === 'straight') return 0;
  if (kind === 'uturn') return 180;
  return angle;
}

const ICONS = {
  turn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V6M5.5 12.5 12 6l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 20h18.4L12 4Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v5M12 17.6v.1" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

export interface NavBar {
  show(on: boolean): void;
  banner(b: BannerState): void;
  stats(s: Stats): void;
  /** The route as runs of shade and sun, with a "you are here" marker at fraction 0–1. */
  strip(runs: { sun: boolean; m: number }[], marker: number): void;
  marker(fraction: number): void;
  summary(s: Summary | null): void;
  recenter(visible: boolean): void;
  toast(msg: string, opts?: { ms?: number; action?: { label: string; run: () => void } }): void;
  voice(on: boolean, available: boolean): void;
  /** Height of the banner and of the bar in pixels, for map padding. */
  size(): { top: number; bottom: number };
  onEnd(fn: () => void): void;
  onRecenter(fn: () => void): void;
  onVoice(fn: () => void): void;
}

export function createNavBar(): NavBar {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const banner = $('nav-banner');
  const bar = $('nav-bar');
  const icon = $('nav-icon');
  const dist = $('nav-dist');
  const instr = $('nav-instr');
  const sub = $('nav-sub');
  const stripEl = $('nav-strip');
  const recenterBtn = $<HTMLButtonElement>('nav-recenter');
  const toastEl = $('nav-toast');
  const voiceBtn = $<HTMLButtonElement>('nav-voice');
  const endBtn = $<HTMLButtonElement>('nav-end');
  const summaryEl = $('nav-summary');
  const statsEl = $('nav-stats');
  let toastTimer = 0;
  let lastIcon = '';

  // Other chrome (north button, map credit, recenter) sits clear of the banner and the bar.
  const sync = () => {
    const root = document.documentElement.style;
    root.setProperty('--banner-h', `${banner.hidden ? 0 : banner.offsetHeight}px`);
    root.setProperty('--bar-h', `${bar.hidden ? 0 : bar.offsetHeight}px`);
  };
  const ro = new ResizeObserver(sync);
  ro.observe(banner);
  ro.observe(bar);

  return {
    show(on) {
      banner.hidden = bar.hidden = !on;
      // Nothing to show in the stats until the first fix lands: they appear with stats().
      statsEl.hidden = stripEl.hidden = true;
      summaryEl.hidden = true;
      endBtn.textContent = 'End';
      if (!on) recenterBtn.hidden = toastEl.hidden = true;
      sync();
    },
    banner(b) {
      if (b.icon !== lastIcon) {
        icon.innerHTML = ICONS[b.icon];
        lastIcon = b.icon;
      }
      icon.style.transform = b.icon === 'turn' ? `rotate(${b.angle ?? 0}deg)` : '';
      icon.classList.toggle('pulse', b.icon === 'search');
      dist.textContent = b.dist ?? '';
      dist.hidden = !b.dist;
      instr.textContent = b.instr;
      sub.textContent = b.sub ?? '';
      sub.hidden = !b.sub;
      banner.classList.toggle('warn', !!b.warn);
    },
    stats(s) {
      statsEl.hidden = stripEl.hidden = false;
      $('nav-arrive').textContent = s.arrive;
      $('nav-left').textContent = s.left;
      $('nav-sun').textContent = s.sun;
    },
    strip(runs, marker) {
      const total = runs.reduce((a, r) => a + r.m, 0) || 1;
      stripEl.innerHTML =
        runs.map((r) => `<i${r.sun ? ' class="sun"' : ''} style="flex:0 0 ${((r.m / total) * 100).toFixed(2)}%"></i>`).join('') +
        `<b class="marker" style="left:${(marker * 100).toFixed(1)}%"></b>`;
    },
    marker(f) {
      const m = stripEl.querySelector<HTMLElement>('.marker');
      if (m) m.style.left = `${(Math.max(0, Math.min(1, f)) * 100).toFixed(1)}%`;
    },
    summary(s) {
      summaryEl.hidden = !s;
      endBtn.textContent = s ? 'Done' : 'End';
      if (s) {
        statsEl.hidden = stripEl.hidden = true;
        $('nav-summary-line').textContent = s.line;
        $('nav-summary-sun').textContent = s.sun;
      }
    },
    recenter(v) {
      recenterBtn.hidden = !v;
    },
    toast(msg, opts = {}) {
      clearTimeout(toastTimer);
      toastEl.replaceChildren();
      const text = document.createElement('span');
      text.textContent = msg;
      toastEl.append(text);
      if (opts.action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = opts.action.label;
        b.onclick = () => {
          toastEl.hidden = true;
          opts.action!.run();
        };
        toastEl.append(b);
      }
      toastEl.hidden = false;
      toastTimer = window.setTimeout(() => (toastEl.hidden = true), opts.ms ?? 3500);
    },
    voice(on, available) {
      voiceBtn.hidden = !available;
      voiceBtn.setAttribute('aria-pressed', String(on));
      voiceBtn.textContent = on ? 'Voice on' : 'Voice off';
    },
    size() {
      return { top: banner.hidden ? 0 : banner.offsetHeight, bottom: bar.hidden ? 0 : bar.offsetHeight };
    },
    onEnd(fn) {
      endBtn.onclick = fn;
    },
    onRecenter(fn) {
      recenterBtn.onclick = fn;
    },
    onVoice(fn) {
      voiceBtn.onclick = fn;
    },
  };
}
