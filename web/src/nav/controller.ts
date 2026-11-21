// Live navigation: ties the position source, the snapping, the maneuvers, the shade guidance and the map
// together while someone walks. Routes are only ever made by the router passed in (nothing is reimplemented here).
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Graph, LonLat, Route, Router, ShadeData } from '../routing/index.ts';
import { clockTime, slotAt } from '../ui/time.ts';
import { fmtDist, iconAngle, type NavBar } from '../ui/navbar.ts';
import { angleDiff, easeAngle, makeProjector, slicePath, type Fix } from './geo.ts';
import { buildLegs, legAt, type Leg } from './legs.ts';
import { buildManeuvers, instruction, nextManeuver, type Maneuver } from './maneuvers.ts';
import { OffRouteMonitor } from './offroute.ts';
import { paceMs } from './pace.ts';
import { GeolocationSource, keepAwake, SimSource, type PositionSource } from './position.ts';
import { advance, buildNavPath, hasArrived, type NavPath, type Progress } from './progress.ts';
import { describeShade, remainingSunMin, shadeAhead, sunRuns, WALK_SPEED_MS, worthSwitching } from './shade.ts';

export interface NavDeps {
  map: MapLibreMap;
  graph: Graph;
  shade: ShadeData;
  router: Router;
  ui: NavBar;
  getSlot(): number; // the time slider's slot (a simulated walk starts its clock there)
  getAlpha(): number; // shade hunger, for reroutes
  /** The page hides its own route lines, pins and sheet while navigating. */
  onChange(active: boolean): void;
  /** `?sim`: walk the route with a fake GPS, `mult` times faster than real time. */
  sim: { mult: number } | null;
}

export interface Navigation {
  readonly active: boolean;
  start(route: Route): void;
  stop(): void;
  /** Course-up (the map turns as you do) or north-up. */
  toggleOrientation(): void;
}

type State = 'idle' | 'starting' | 'navigating' | 'arrived';

const RED = '#d7322c';
const SUN = '#f2b33d';
const BLUE = '#2b6cd1';
const OUTSIDE_SLACK = 0.0003; // ≈30 m of slack around the bbox before a fix counts as off the map
const FOLLOW_ZOOM = 18;
const WEAK_AFTER_MS = 12_000;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function createNavigation(d: NavDeps): Navigation {
  const { map, graph, shade, router, ui } = d;
  const origin: LonLat = [graph.venue.lon, graph.venue.lat];
  const proj = makeProjector(origin);
  const destPos = new Map(graph.nodes.map((n) => [n.id, [n.lon, n.lat] as LonLat]));

  let state: State = 'idle';
  let source: PositionSource | null = null;
  let releaseAwake: (() => void) | null = null;
  let weakTimer = 0;

  // The route being followed.
  let route!: Route;
  let nav!: NavPath;
  let legs: Leg[] = [];
  let maneuvers: Maneuver[] = [];
  let destNode = '';
  let prog: Progress | null = null;
  let monitor = new OffRouteMonitor();
  let stripKey = '';

  // The walk so far (kept across reroutes, for the arrival summary and the pace).
  let firstFix: Fix | null = null;
  let lastFix: Fix | null = null;
  let lastFixWall = 0;
  let walkedTotal = 0;
  let sunMetres = 0;
  let spokenIdx = -1;
  let offerSlot = -1; // the slot we last looked for a better route in

  // Camera.
  let follow = true;
  let courseUp = true;
  let camHeading = 0;
  let camReady = false;

  let voiceOn = false;
  const speech = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  const slotNow = (t: number) => slotAt(new Date(t));
  const sunOfAt = (slot: number) => (leg: Leg) => shade.sunFraction[leg.id]?.[slot] ?? 1; // missing data counts as full sun

  // ---------- map layers ----------
  const src = (id: string) => map.getSource<GeoJSONSource>(id);
  function ensureLayers() {
    if (map.getSource('nav-route')) return;
    for (const id of ['nav-route', 'nav-walked', 'nav-ring', 'nav-cone', 'nav-puck']) map.addSource(id, { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'nav-route', type: 'line', source: 'nav-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': RED, 'line-width': 8 } });
    map.addLayer({ id: 'nav-route-sun', type: 'line', source: 'nav-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': SUN, 'line-width': 4, 'line-opacity': ['get', 'sun'] } });
    map.addLayer({ id: 'nav-walked', type: 'line', source: 'nav-walked', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9aa0a4', 'line-width': 8, 'line-opacity': 0.95 } });
    map.addLayer({ id: 'nav-ring', type: 'fill', source: 'nav-ring', paint: { 'fill-color': BLUE, 'fill-opacity': 0.14 } });
    map.addLayer({ id: 'nav-cone', type: 'fill', source: 'nav-cone', paint: { 'fill-color': BLUE, 'fill-opacity': 0.3 } });
    map.addLayer({ id: 'nav-puck', type: 'circle', source: 'nav-puck', paint: { 'circle-radius': 9, 'circle-color': BLUE, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3.5 } });
  }

  const toLL = (pts: [number, number][]) => pts.map((p) => proj.toLonLat(p));

  function drawRoute() {
    const slot = lastFix ? slotNow(lastFix.t) : d.getSlot();
    const sunOf = sunOfAt(slot);
    src('nav-route')?.setData({
      type: 'FeatureCollection',
      features: legs.map((l) => ({
        type: 'Feature',
        properties: { sun: sunOf(l) },
        geometry: { type: 'LineString', coordinates: toLL(slicePath(nav.path, l.start_m, l.end_m)) },
      })),
    });
    src('nav-walked')?.setData(EMPTY);
  }

  function drawPuck(at: LonLat, accuracy: number, heading: number) {
    const [x, y] = proj.toXY(at);
    const ring: [number, number][] = [];
    const r = Math.min(Math.max(accuracy, 4), 80);
    for (let a = 0; a < 360; a += 10) ring.push([x + r * Math.sin((a * Math.PI) / 180), y + r * Math.cos((a * Math.PI) / 180)]);
    ring.push(ring[0]);
    const cone: [number, number][] = [[x, y]];
    for (let a = -35; a <= 35; a += 7) cone.push([x + 24 * Math.sin(((heading + a) * Math.PI) / 180), y + 24 * Math.cos(((heading + a) * Math.PI) / 180)]);
    cone.push([x, y]);
    const poly = (c: [number, number][]): Feature<Polygon> => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [toLL(c)] } });
    src('nav-ring')?.setData({ type: 'FeatureCollection', features: [poly(ring)] });
    src('nav-cone')?.setData({ type: 'FeatureCollection', features: [poly(cone)] });
    src('nav-puck')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at } }] });
  }

  function drawWalked(s: number) {
    src('nav-walked')?.setData(
      s > 0.5 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: toLL(slicePath(nav.path, 0, s)) } }] } : EMPTY,
    );
  }

  // ---------- camera ----------
  function moveCamera(at: LonLat, heading: number, jump = false) {
    if (!follow) return;
    camHeading = camReady ? easeAngle(camHeading, heading, 0.3) : heading;
    const bearing = courseUp ? camHeading : 0;
    const { top, bottom } = ui.size();
    // The dot sits a little below the middle of the free map, so there is more road ahead than behind.
    const opts = { center: at, zoom: jump || !camReady ? FOLLOW_ZOOM : Math.max(map.getZoom(), 17), bearing, padding: { top: top + 60, bottom, left: 0, right: 0 } };
    if (jump || !camReady) map.jumpTo(opts);
    else map.easeTo({ ...opts, duration: 900, easing: (t) => t });
    camReady = true;
  }

  map.on('movestart', (e) => {
    // Only a drag, pinch or rotate by the user (they carry the original event) pauses following.
    if (state === 'idle' || !('originalEvent' in e) || !e.originalEvent) return;
    follow = false;
    ui.recenter(true);
  });

  // ---------- voice ----------
  function say(text: string) {
    if (!voiceOn || !speech) return;
    speech.cancel();
    speech.speak(new SpeechSynthesisUtterance(text));
  }
  const spoken = (m: Maneuver, dist: number) => `${dist > 15 ? `In ${fmtDist(dist).replace(' m', ' metres').replace(' km', ' kilometres')}, ` : ''}${instruction(m).replace(/^Arrive at/, 'You will arrive at').replace(/^(.)/, (c) => c.toLowerCase())}`;

  // ---------- following a route ----------
  function setRoute(r: Route) {
    route = r;
    nav = buildNavPath(r.coords, origin);
    legs = buildLegs(r, graph, nav);
    maneuvers = buildManeuvers(r, graph, nav, legs);
    destNode = r.nodes[r.nodes.length - 1];
    prog = null;
    spokenIdx = -1;
    stripKey = '';
    offerSlot = -1;
    drawRoute();
  }

  function outsideMap(f: Fix) {
    const [x0, y0, x1, y1] = graph.bbox;
    return f.lon < x0 - OUTSIDE_SLACK || f.lon > x1 + OUTSIDE_SLACK || f.lat < y0 - OUTSIDE_SLACK || f.lat > y1 + OUTSIDE_SLACK;
  }

  function reroute(f: Fix, why: 'start' | 'off') {
    const from = router.nearestNode(f.lon, f.lat);
    monitor.reset(f.t);
    if (from === destNode) return finish(f);
    const r = router.route(from, destNode, d.getAlpha(), slotNow(f.t));
    if (!r) {
      ui.toast("No walking route from here. Head back toward the map.", { ms: 5000 });
      return;
    }
    setRoute(r);
    ui.toast(why === 'start' ? 'Routing from where you are' : 'Rerouting…');
    say(why === 'start' ? 'Routing from where you are' : 'Rerouting');
    prog = advance(nav, f, null);
    render(f);
  }

  // The shade moves with the clock: when the slot changes (or the plan was for another time than now), look for a
  // shadier way from the next junction on. It is only ever offered, never switched silently.
  function maybeOffer(slot: number) {
    if (!prog) return;
    const idx = legs.findIndex((l) => prog!.walked_m < l.end_m);
    if (idx < 0 || idx >= legs.length - 1) return; // on the last street: nothing to choose
    const alt = router.route(legs[idx].to, destNode, d.getAlpha(), slot);
    const ahead = route.edges.slice(idx + 1);
    if (!alt || alt.edges.join() === ahead.join()) return;
    const cur = router.summarize({ nodes: route.nodes.slice(idx + 1), edges: ahead, coords: [] }, slot);
    const next = router.summarize(alt, slot);
    if (!worthSwitching(cur, next)) return;
    const extra = Math.round(next.walk_min - cur.walk_min);
    ui.toast(`A shadier way: ${(cur.sun_min - next.sun_min).toFixed(1)} min less sun${extra > 0 ? `, ${extra} min longer` : ''}`, {
      ms: 15_000,
      action: {
        label: 'Switch',
        run() {
          // Keep the street being walked, then the new way; the walked part is unchanged, so progress carries over.
          const keep = prog;
          const k = nav.path.cum.findIndex((c) => c >= legs[idx].end_m - 1e-6);
          setRoute({
            nodes: [...route.nodes.slice(0, idx + 1), ...alt.nodes],
            edges: [...route.edges.slice(0, idx + 1), ...alt.edges],
            coords: [...route.coords.slice(0, k + 1), ...alt.coords.slice(1)],
          });
          prog = keep;
          offerSlot = slot;
          if (lastFix) render(lastFix);
        },
      },
    });
  }

  function onFix(f: Fix) {
    if (state === 'idle' || state === 'arrived') return;
    lastFix = f;
    lastFixWall = Date.now();
    firstFix ??= f;

    if (outsideMap(f)) {
      state = 'starting'; // wait for them to come inside the map
      prog = null;
      ui.banner({ icon: 'warn', instr: "You're outside the shade map", sub: 'It covers about 600 m around Tanda HQ. Tap End to stop.', warn: true });
      drawPuck([f.lon, f.lat], f.accuracy_m, camHeading);
      return;
    }

    state = 'navigating';
    if (!prog) {
      // First usable fix on this route: if they aren't where the route starts, route from where they are.
      const first = advance(nav, f, null);
      if (first.off_m > Math.max(40, 1.5 * f.accuracy_m) && first.accurate) return reroute(f, 'start');
      prog = first; // starting partway along the route doesn't count as walked
    } else {
      const prevS = prog.walked_m;
      prog = advance(nav, f, prog);
      const dS = prog.walked_m - prevS;
      if (dS > 0) {
        walkedTotal += dS;
        sunMetres += dS * (legAt(legs, prog.walked_m) ? sunOfAt(slotNow(f.t))(legAt(legs, prog.walked_m)!) : 1);
      }
    }

    if (hasArrived(prog)) return finish(f);
    if (monitor.update({ off_m: prog.off_m, accuracy_m: f.accuracy_m, t: f.t }) === 'off') return reroute(f, 'off');
    render(f);
  }

  function render(f: Fix) {
    if (!prog) return;
    const slot = slotNow(f.t);
    const sunOf = sunOfAt(slot);
    const { m, i } = nextManeuver(maneuvers, prog.walked_m);
    const toNext = Math.max(0, m.at_m - prog.walked_m);

    const shadeText = describeShade(shadeAhead(legs, prog.walked_m, sunOf));
    const weak = f.accuracy_m > 50;
    const atStart = prog.walked_m < 12 && maneuvers[0]?.kind === 'depart' && walkedTotal < 12;
    ui.banner(
      atStart
        ? { icon: 'turn', angle: 0, instr: instruction(maneuvers[0]), sub: weak ? 'GPS signal weak' : (shadeText ?? undefined), warn: false }
        : { icon: m.kind === 'arrive' ? 'pin' : 'turn', angle: iconAngle(m.kind, m.angle), dist: fmtDist(toNext), instr: instruction(m), sub: weak ? 'GPS signal weak' : (shadeText ?? undefined), warn: false },
    );

    // Arrival time from the pace walked so far (1.3 m/s until there is something to measure).
    const elapsed = firstFix ? (f.t - firstFix.t) / 1000 : 0;
    const pace = paceMs(walkedTotal, elapsed) || WALK_SPEED_MS;
    ui.stats({ arrive: clockTime(f.t + (prog.remaining_m / pace) * 1000), left: fmtDist(prog.remaining_m), sun: remainingSunMin(legs, prog.walked_m, sunOf).toFixed(1) });
    const key = `${route.edges.join(',')}:${slot}`;
    if (key !== stripKey) {
      stripKey = key;
      ui.strip(sunRuns(legs, sunOf), prog.walked_m / (nav.path.total || 1));
      drawRoute();
    } else ui.marker(prog.walked_m / (nav.path.total || 1));

    // Where the dot goes: on the route when we're on it, at the raw fix when we're not.
    const onRoute = prog.accurate && prog.off_m <= 12;
    const at: LonLat = onRoute ? prog.snapped : [f.lon, f.lat];
    const moving = (f.speed ?? 0) >= 0.8 && typeof f.heading === 'number' && Number.isFinite(f.heading);
    const heading = moving ? (f.heading as number) : prog.heading;
    drawPuck(at, f.accuracy_m, heading);
    drawWalked(prog.walked_m);
    moveCamera(at, heading);

    if (slot !== offerSlot) {
      offerSlot = slot;
      maybeOffer(slot);
    }

    if (i !== spokenIdx && toNext <= 45 && m.kind !== 'arrive') {
      spokenIdx = i;
      say(spoken(m, toNext));
    }
  }

  function finish(f: Fix) {
    state = 'arrived';
    source?.stop();
    source = null;
    const secs = firstFix ? Math.max(1, Math.round((f.t - firstFix.t) / 1000)) : 0;
    const mins = Math.max(1, Math.round(secs / 60));
    ui.banner({ icon: 'pin', instr: "You've arrived" });
    ui.summary({ line: `Walked ${fmtDist(walkedTotal)} in ${mins} min`, sun: `${(sunMetres / WALK_SPEED_MS / 60).toFixed(1)} min in the sun` });
    const end = destPos.get(destNode);
    if (end) drawPuck(end, 5, camHeading);
    drawWalked(nav.path.total);
    say("You've arrived");
  }

  function onError(kind: string, message: string) {
    if (state === 'idle' || state === 'arrived') return;
    if (kind === 'denied' || kind === 'unsupported') {
      source?.stop();
      source = null;
      ui.banner({ icon: 'warn', instr: kind === 'denied' ? 'Location is off' : "Can't use your location", sub: message, warn: true });
      return;
    }
    if (!prog) ui.banner({ icon: 'warn', instr: 'Still looking for you…', sub: message, warn: true });
    // Once we've had a fix, the weak-signal timer says so without throwing the instruction away.
  }

  function checkWeak() {
    if (state !== 'navigating' || !lastFix || d.sim) return;
    if (Date.now() - lastFixWall > WEAK_AFTER_MS) ui.banner({ icon: 'warn', instr: 'GPS signal lost', sub: 'Keep going. We will find you again.', warn: true });
  }

  // ---------- start and stop ----------
  function start(r: Route) {
    if (state !== 'idle') return;
    ensureLayers();
    state = 'starting';
    follow = true;
    camHeading = 0;
    camReady = false;
    firstFix = lastFix = null;
    walkedTotal = sunMetres = 0;
    monitor = new OffRouteMonitor();
    setRoute(r);
    ui.show(true);
    ui.recenter(false);
    ui.summary(null);
    ui.voice(voiceOn, !!speech);
    ui.banner({ icon: 'search', instr: d.sim ? 'Starting a simulated walk…' : 'Finding your location…' });
    d.onChange(true);
    releaseAwake = keepAwake();
    if (voiceOn) speech?.speak(new SpeechSynthesisUtterance('')); // iOS only lets speech start from a tap: this is one
    if (d.sim) {
      const t0 = Date.parse(`${shade.date}T00:00:00+10:00`) + (360 + 15 * d.getSlot()) * 60_000;
      source = new SimSource(nav, { t0, mult: d.sim.mult });
      map.jumpTo({ center: r.coords[0], zoom: FOLLOW_ZOOM });
    } else source = new GeolocationSource();
    source.start(onFix, onError);
    weakTimer = window.setInterval(checkWeak, 2000);
  }

  function stop() {
    if (state === 'idle') return;
    state = 'idle';
    source?.stop();
    source = null;
    releaseAwake?.();
    releaseAwake = null;
    clearInterval(weakTimer);
    speech?.cancel();
    for (const id of ['nav-route', 'nav-walked', 'nav-ring', 'nav-cone', 'nav-puck']) src(id)?.setData(EMPTY);
    ui.show(false);
    map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
    d.onChange(false);
  }

  ui.onEnd(stop);
  ui.onRecenter(() => {
    follow = true;
    ui.recenter(false);
    const at = prog?.snapped;
    if (at) moveCamera(at, prog!.heading, true);
  });
  ui.onVoice(() => {
    voiceOn = !voiceOn;
    ui.voice(voiceOn, !!speech);
    if (voiceOn) speech?.speak(new SpeechSynthesisUtterance('Voice on'));
    else speech?.cancel();
  });

  return {
    get active() {
      return state !== 'idle';
    },
    start,
    stop,
    toggleOrientation() {
      courseUp = !courseUp;
      ui.toast(courseUp ? 'Map turns as you walk' : 'North is up');
      if (prog) moveCamera(prog.snapped, prog.heading);
    },
  };
}
