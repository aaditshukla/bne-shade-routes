import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre builds its worker URL at runtime, so Vite never copies the file; ?url makes it ship.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';
import { createRouter, loadData, type Graph, type Route, type ShadeData } from './routing/index.ts';
import type { ShadeView } from './three/index.ts';
import { buildPlaces, searchPlaces, type Place } from './ui/places.ts';
import { slotAt, slotTime } from './ui/time.ts';
import { loadShadows } from './ui/shadows.ts';
import { LANDMARKS } from './ui/landmarks.ts';
import type { FeatureCollection } from 'geojson';

let slot = slotAt(new Date());
let alpha = 5; // shade hunger for the shadiest route
// Shadow-study palette (see style.css): redline for the route in focus, dashed grey for the other.
const INK = '#26282a';
const RED = '#d7322c';
const GREY = '#6e7275';
const ROUTES = [
  { id: 'shortest', label: 'Shortest' },
  { id: 'shadiest', label: 'Shadiest' },
] as const;
type RouteId = (typeof ROUTES)[number]['id'];

const results = document.getElementById('results')!;
let data: { graph: Graph; shade: ShadeData };
try {
  data = await loadData();
} catch (err) {
  results.innerHTML = `<p class="headline">Couldn't load the map data. Reload to try again.</p>`;
  throw err;
}
const { graph, shade } = data;
results.innerHTML = '';
const router = createRouter(graph, shade);
const places = buildPlaces(graph);
// Landmarks are searchable too, right after the venue; they route to the nearest street node.
const landmarks = LANDMARKS.map((l) => ({ label: l.name, node: router.nearestNode(l.lon, l.lat) }));
places.splice(1, 0, ...landmarks);
let from: Place = places[0]; // the venue
let to: Place | null = null;
const VENUE: [number, number] = [graph.venue.lon, graph.venue.lat];
const nodeAt = new Map(graph.nodes.map((n) => [n.id, [n.lon, n.lat] as [number, number]]));
const edgeLength = new Map(graph.edges.map((e) => [e.id, e.length_m]));
const edgeGeom = new Map(graph.edges.map((e) => [e.id, e.geometry]));
const SUN = '#f2b33d'; // the strip's amber (--sun in style.css)

maplibregl.setWorkerUrl(workerUrl);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: VENUE,
  zoom: 16,
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
// Keep the venue centred in the part of the map the bottom sheet doesn't cover.
const sheet = document.getElementById('sheet')!;
const threeEl = document.getElementById('three')!;
// On a laptop the sheet is a card floating on the left (see style.css), so it covers the map's left edge instead.
const WIDE = matchMedia('(min-width: 900px)');
const sheetCover = () =>
  WIDE.matches ? { top: 0, right: 0, bottom: 0, left: sheet.offsetLeft + sheet.offsetWidth } : { top: 0, right: 0, bottom: sheet.offsetHeight, left: 0 };
// setPadding is a jumpTo, which cancels a running fitBounds, so only call it when the cover really changed.
new ResizeObserver(() => {
  const p = map.getPadding(), c = sheetCover();
  if (p.bottom !== c.bottom || p.left !== c.left) map.setPadding(c);
}).observe(sheet);

// Both pins drag to move that end of the route, like any maps app.
function makePin(cls: string, label: string) {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-label', label);
  return new maplibregl.Marker({ element: el, draggable: true });
}
const startPin = makePin('venue-pin', 'Start').setLngLat(VENUE).addTo(map);
const destPin = makePin('dest-pin', 'Destination');
// Landmark pins: tap one to make it the end you're setting (the destination, unless you're editing From).
LANDMARKS.forEach((l, i) => {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'landmark';
  el.textContent = l.name;
  el.onclick = (e) => {
    e.stopPropagation(); // not a map tap too
    const end = active;
    setEnd(end, landmarks[i]);
    if (end === 'from') setActive('to');
  };
  new maplibregl.Marker({ element: el, anchor: 'left', offset: [-5, 0] }).setLngLat([l.lon, l.lat]).addTo(map);
});
// Latest line per route; also used to seed the sources if a pick lands before the map has loaded.
const lines: Record<string, FeatureCollection> = {};
let selected: RouteId = 'shadiest';
// 3D view (W8): created on the first toggle; fed the same routes and slot as the 2D map.
let view: ShadeView | null = null;
let routes3d: { shortest: Route; shadiest: Route } | null = null;

const fmtMin = (m: number) => m.toFixed(1);

// A route as runs of shade and sun, in metres. Each edge splits into its shaded and sunny length,
// so the strip's amber adds up to exactly the sun minutes on the card.
function sunRuns(r: Route): { sun: boolean; m: number }[] {
  const runs: { sun: boolean; m: number }[] = [];
  for (const id of r.edges) {
    const len = edgeLength.get(id) ?? 0;
    const f = shade.sunFraction[id]?.[slot] ?? 1;
    for (const [sun, m] of [[false, len * (1 - f)], [true, len * f]] as const) {
      if (m <= 0) continue;
      const last = runs[runs.length - 1];
      if (last?.sun === sun) last.m += m;
      else runs.push({ sun, m });
    }
  }
  return runs;
}
const strip = (r: Route, total: number, scale: number) =>
  `<span class="strip" style="width:${((total / scale) * 100).toFixed(1)}%">${sunRuns(r)
    .map((x) => `<i${x.sun ? ' class="sun"' : ''} style="flex:0 0 ${((x.m / total) * 100).toFixed(2)}%"></i>`)
    .join('')}</span>`;

// Shadow overlay (W6): the slot's shadow file, or streets coloured by sunFraction if that file is missing.
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
let shadowData = EMPTY;
let streetData = EMPTY;
function setOverlay(shadows: FeatureCollection, streets: FeatureCollection) {
  shadowData = shadows;
  streetData = streets;
  map.getSource<maplibregl.GeoJSONSource>('shadows')?.setData(shadows);
  map.getSource<maplibregl.GeoJSONSource>('streets')?.setData(streets);
}
const streetsBySun = (): FeatureCollection => ({
  type: 'FeatureCollection',
  features: graph.edges.map((e) => ({
    type: 'Feature',
    properties: { sun: shade.sunFraction[e.id]?.[slot] ?? 1 },
    geometry: { type: 'LineString', coordinates: e.geometry },
  })),
});
const sunUp = (s: number) => (shade.sun[s]?.alt_deg ?? 0) > 0;
async function showShadows() {
  if (!sunUp(slot)) return setOverlay(EMPTY, EMPTY); // after sunset: no file, nothing to draw
  for (const s of [slot - 1, slot + 1]) if (sunUp(s)) loadShadows(shade.slots[s]); // prefetch so dragging stays smooth
  const want = slot;
  const fc = await loadShadows(shade.slots[slot]);
  if (want !== slot) return; // the slider moved on while this loaded
  if (fc) setOverlay(fc, EMPTY);
  else setOverlay(EMPTY, streetsBySun());
}

function clearRoutes() {
  for (const { id } of ROUTES) {
    lines[id] = EMPTY;
    map.getSource<maplibregl.GeoJSONSource>(id)?.setData(EMPTY);
  }
  routes3d = null;
  show3d();
}

function show() {
  startPin.setLngLat(nodeAt.get(from.node)!);
  swapBtn.disabled = !to;
  if (!to) return;
  const a = from.node;
  const b = to.node;
  destPin.setLngLat(nodeAt.get(b)!).addTo(map);
  if (a === b) {
    clearRoutes();
    results.innerHTML = `<p class="headline">Start and destination are the same spot.</p>`;
    return;
  }
  const found = ROUTES.map((spec) => {
    const r = router.route(a, b, spec.id === 'shortest' ? 0 : alpha, slot);
    return { spec, r, s: r && router.summarize(r, slot) };
  });

  const [short, shady] = found;
  // Ties (different streets, same sun) count as one route; show the shorter one in shadiest colours.
  const same = !!short.s && !!shady.s && short.s.sun_min - shady.s.sun_min < 0.05;
  if (same) {
    shady.r = short.r;
    shady.s = short.s;
    short.r = null;
  }
  // One feature per street, carrying its sun at this slot, so the line shows where the walk is sunny.
  for (const { spec, r } of found) {
    lines[spec.id] = {
      type: 'FeatureCollection',
      features: (r?.edges ?? []).map((id) => ({
        type: 'Feature',
        properties: { sun: shade.sunFraction[id]?.[slot] ?? 1 },
        geometry: { type: 'LineString', coordinates: edgeGeom.get(id)! },
      })),
    };
    map.getSource<maplibregl.GeoJSONSource>(spec.id)?.setData(lines[spec.id]);
  }
  const shortestRoute = same ? shady.r : short.r;
  routes3d = shortestRoute && shady.r ? { shortest: shortestRoute, shadiest: shady.r } : null;
  show3d();
  if (!shady.s || (!same && !short.s)) {
    results.innerHTML = `<p class="headline">No walking route to there.</p>`;
    return;
  }
  // Contract: extra minutes from walk_min, "% less sun" from sun_min.
  const extra = same ? 0 : Math.round(shady.s.walk_min - short.s!.walk_min);
  const less = same ? 0 : Math.round((1 - shady.s.sun_min / short.s!.sun_min) * 100);
  const headline = same
    ? 'The shortest way is already the shadiest.'
    : `Shadiest way: <b>${less}% less sun</b> for ${extra > 0 ? `${extra} min extra` : 'no extra walk'}.`;
  const shown = same ? [shady] : [shady, short]; // shadiest first: it's the answer
  const scale = Math.max(...shown.map(({ s }) => s!.distance_m));
  const rows = shown.map(({ spec, r, s }) => `
    <button class="route" data-route="${spec.id}">
      <span class="route-name"><span class="key"></span>${same ? 'Shortest and shadiest' : spec.label}</span>
      <small class="route-meta">${Math.round(s!.distance_m)} m · ${Math.max(1, Math.round(s!.walk_min))} min · arrive ${slotTime(slot, s!.walk_min)}</small>
      <span class="mins">${fmtMin(s!.sun_min)}<small>min in sun</small></span>
      ${strip(r!, s!.distance_m, scale)}
    </button>`);
  results.innerHTML = `<p class="headline">${headline}</p>${rows.join('')}`;
  select(same ? 'shadiest' : selected);
}

// Focus one route: its card is pressed, its key and line turn solid red and sit on top; the other goes dashed grey.
function select(id: RouteId) {
  selected = id;
  for (const c of results.querySelectorAll('[data-route]')) {
    const on = c.getAttribute('data-route') === id;
    c.setAttribute('aria-pressed', String(on));
    c.querySelector('.key')?.classList.toggle('dashed', !on);
  }
  show3d();
  if (!map.getLayer(id)) return; // map still loading; the load handler applies it
  for (const { id: other } of ROUTES) {
    const on = other === id;
    map.setPaintProperty(other, 'line-color', on ? RED : GREY);
    map.setPaintProperty(other, 'line-width', on ? 7 : 3.5);
    map.setPaintProperty(other, 'line-dasharray', on ? undefined : [2, 1.5]);
    map.setPaintProperty(other, 'line-opacity', on ? 1 : 0.6);
    map.setLayoutProperty(`${other}-sun`, 'visibility', on ? 'visible' : 'none');
  }
  map.moveLayer(id);
  map.moveLayer(`${id}-sun`);
}

// The 3D view draws its 'shadiest' route in red on top, so hand it the route in focus there.
function show3d() {
  if (!view || !routes3d) return view?.showRoutes(null);
  view.showRoutes(selected === 'shadiest' ? routes3d : { shortest: routes3d.shadiest, shadiest: routes3d.shortest });
}

results.onclick = (e) => {
  const card = (e.target as Element).closest('[data-route]');
  if (card) select(card.getAttribute('data-route') as RouteId);
};

// From/To fields. Typing searches street names and junctions; a map tap or a pin drag fills the
// active field (To until you touch From). Everything stays inside the bbox: there is no live geocoder.
type End = 'from' | 'to';
const inputs = { from: document.getElementById('from') as HTMLInputElement, to: document.getElementById('to') as HTMLInputElement };
const suggestEl = document.getElementById('suggest')!;
const swapBtn = document.getElementById('swap') as HTMLButtonElement;
const noticeEl = document.getElementById('notice')!;
const MY_LOCATION = 'My location';
let active: End = 'to';
let options: Place[] = [];

function notice(msg: string) {
  noticeEl.textContent = msg;
  noticeEl.hidden = !msg;
}
function setActive(end: End) {
  active = end;
  for (const k of ['from', 'to'] as const) inputs[k].closest('.field')!.classList.toggle('active', k === end);
}
const restoreInputs = () => {
  inputs.from.value = from.label;
  inputs.to.value = to?.label ?? '';
};

// Frame both routes when an end moves (not on slider moves, so the map doesn't jump while dragging).
function frame() {
  map.setPadding(sheetCover()); // the sheet just shrank back from search; don't wait for the observer
  const bounds = new maplibregl.LngLatBounds();
  for (const fc of Object.values(lines))
    for (const f of fc.features) if (f.geometry.type === 'LineString') for (const c of f.geometry.coordinates) bounds.extend(c as [number, number]);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 80, bottom: 48, left: 48, right: 48 }, maxZoom: 17 }); // top leaves room for the pin
  else map.easeTo({ center: nodeAt.get(from.node)! });
}

function setEnd(end: End, place: Place) {
  if (end === 'from') from = place;
  else to = place;
  notice('');
  restoreInputs();
  if (end === 'from' && !to) setActive('to');
  show();
  frame();
}

// A point on the map or from GPS: snap to the nearest graph node, or say it's off the map.
const M = 0.0003; // ≈30 m of slack around the bbox before a point counts as off the map
function setEndAt(end: End, [lon, lat]: [number, number], label: string) {
  const [x0, y0, x1, y1] = graph.bbox;
  if (lon < x0 - M || lon > x1 + M || lat < y0 - M || lat > y1 + M) {
    notice(`${label === MY_LOCATION ? "You're" : "That's"} outside the shade map. It covers about 600 m around Tanda HQ, Fortitude Valley.`);
    show(); // put a dragged pin back
    return;
  }
  setEnd(end, { label, node: router.nearestNode(lon, lat) });
}

function locate(end: End) {
  if (!navigator.geolocation) return notice("This browser can't share your location.");
  notice('Finding you…');
  navigator.geolocation.getCurrentPosition(
    (p) => setEndAt(end, [p.coords.longitude, p.coords.latitude], MY_LOCATION),
    () => notice("Couldn't get your location. Search or tap the map instead."),
    { enableHighAccuracy: true, timeout: 10_000 },
  );
}

function renderSuggest(fresh = false) {
  const q = fresh ? '' : inputs[active].value.trim(); // fresh focus: the old label is selected, so offer the defaults
  options = q ? searchPlaces(places, q) : [{ label: MY_LOCATION, node: '' }, places[0]];
  if (q && MY_LOCATION.toLowerCase().startsWith(q.toLowerCase())) options.unshift({ label: MY_LOCATION, node: '' });
  suggestEl.innerHTML = options.length
    ? options.map((o, i) => `<button type="button" data-i="${i}"${o.label === MY_LOCATION ? ' class="loc"' : ''}>${o.label}</button>`).join('')
    : `<p class="empty">No street by that name on the shade map.</p>`;
  suggestEl.hidden = false;
}
function choose(o: Place | undefined) {
  if (!o) return;
  const end = active;
  inputs[end].blur();
  if (o.label === MY_LOCATION) locate(end);
  else setEnd(end, o);
}

for (const end of ['from', 'to'] as const) {
  const input = inputs[end];
  input.onfocus = () => {
    setActive(end);
    document.body.classList.add('searching');
    input.select();
    renderSuggest(true);
  };
  input.oninput = () => renderSuggest();
  input.onblur = () => {
    document.body.classList.remove('searching');
    suggestEl.hidden = true;
    restoreInputs();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') choose(options[0]);
    if (e.key === 'Escape') input.blur();
  };
}
// Keep the field focused through a tap on a suggestion; otherwise blur closes the list before the click lands.
suggestEl.onmousedown = (e) => e.preventDefault();
suggestEl.onclick = (e) => {
  const i = (e.target as Element).closest('[data-i]')?.getAttribute('data-i');
  if (i != null) choose(options[+i]);
};

swapBtn.onclick = () => {
  if (!to) return;
  [from, to] = [to, from];
  restoreInputs();
  show();
};

startPin.on('dragend', () => setEndAt('from', startPin.getLngLat().toArray(), 'Dropped pin'));
destPin.on('dragend', () => setEndAt('to', destPin.getLngLat().toArray(), 'Dropped pin'));
restoreInputs();
setActive('to');

// Sliders: any change recomputes both routes and the card.
const timeInput = document.getElementById('time') as HTMLInputElement;
const alphaInput = document.getElementById('alpha') as HTMLInputElement;
const timeLabel = document.getElementById('time-label')!;
const alphaLabel = document.getElementById('alpha-label')!;
function readSliders() {
  slot = timeInput.valueAsNumber;
  alpha = alphaInput.valueAsNumber;
  const alt = shade.sun[slot].alt_deg;
  timeLabel.textContent = `${slotTime(slot)} · ${alt > 0 ? `sun ${Math.round(alt)}° up` : 'sun down'}`;
  alphaLabel.textContent = String(alpha);
  for (const el of [timeInput, alphaInput]) el.style.setProperty('--p', `${((el.valueAsNumber - +el.min) / (+el.max - +el.min)) * 100}%`);
  showShadows();
  view?.setSlot(slot);
  show();
}
timeInput.value = String(slot);
timeInput.oninput = alphaInput.oninput = readSliders;
readSliders();

// 2D/3D toggle (laptop-only: CSS hides it on touch). three.js and the building/tree files load on first open.
const toggle = document.getElementById('view-toggle') as HTMLButtonElement;
function set3d(on: boolean) {
  toggle.setAttribute('aria-pressed', String(on));
  toggle.textContent = on ? '2D' : '3D';
  threeEl.hidden = !on;
}
toggle.onclick = async () => {
  const on = toggle.getAttribute('aria-pressed') !== 'true';
  set3d(on);
  if (!on || view) return;
  toggle.disabled = true;
  try {
    const getJson = (f: string) => fetch(`${import.meta.env.BASE_URL}data/${f}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${f}: HTTP ${r.status}`))));
    const [{ createShadeView }, buildings, trees] = await Promise.all([import('./three/index.ts'), getJson('buildings.geojson'), getJson('trees.geojson')]);
    view = createShadeView(threeEl, { bbox: graph.bbox, sun: shade.sun, buildings, trees });
    view.setSlot(slot);
    show3d();
  } catch (err) {
    console.error('3D view failed to load', err);
    set3d(false);
  } finally {
    toggle.disabled = false;
  }
};

map.on('click', (e) => {
  const end = active;
  setEndAt(end, [e.lngLat.lng, e.lngLat.lat], 'Dropped pin');
  if (end === 'from') setActive('to'); // next tap sets the destination
});

// North: the shadow study only reads with north known. The arrow turns with the map; tap to reset.
const northBtn = document.getElementById('north')!;
const northArrow = northBtn.querySelector('svg')!;
map.on('rotate', () => (northArrow.style.transform = `rotate(${-map.getBearing()}deg)`));
northBtn.onclick = () => map.resetNorth();

// 45° hatch tile for shadows, drawn once at 2× for sharp lines on retina screens.
function hatchImage() {
  const n = 24; // 12 px apart on screen: open enough to read on a phone
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  for (const o of [-n, 0, n]) {
    g.moveTo(o, n);
    g.lineTo(o + n, 0);
  }
  g.stroke();
  return g.getImageData(0, 0, n, n);
}

map.on('load', () => {
  // MapLibre expands the attribution when source metadata lands (after load); fold it behind its (i) once tiles settle.
  map.once('idle', () => document.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
  // Drafting-white ground under the basemap.
  if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', '#fafaf8');
  // Shadows sit under the basemap's labels; routes go on top of everything.
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addImage('hatch', hatchImage(), { pixelRatio: 2 });
  map.addSource('shadows', { type: 'geojson', data: shadowData });
  map.addLayer({ id: 'shadows', type: 'fill', source: 'shadows', paint: { 'fill-color': INK, 'fill-opacity': 0.18, 'fill-antialias': false } }, firstLabel);
  map.addLayer({ id: 'shadows-hatch', type: 'fill', source: 'shadows', paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.4 } }, firstLabel);
  // Buildings sit on top of their shadows as solid blocks, so hatch only ever means shade on the ground.
  if (map.getLayer('building')) {
    map.moveLayer('building', firstLabel);
    map.setPaintProperty('building', 'fill-color', '#d4d3cc');
    map.setPaintProperty('building', 'fill-outline-color', INK);
  }
  // Street trees as drawn canopy outlines, to scale (metres per pixel at Brisbane's latitude).
  map.addSource('trees', { type: 'geojson', data: `${import.meta.env.BASE_URL}data/trees.geojson` });
  map.addLayer(
    {
      id: 'trees',
      type: 'circle',
      source: 'trees',
      paint: {
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 14, ['/', ['coalesce', ['get', 'canopy_radius_m'], 4], 8.47], 20, ['/', ['coalesce', ['get', 'canopy_radius_m'], 4], 0.1324]],
        'circle-color': '#fff',
        'circle-opacity': 0.6,
        'circle-stroke-color': INK,
        'circle-stroke-width': 1,
      },
    },
    firstLabel,
  );
  map.addSource('streets', { type: 'geojson', data: streetData });
  map.addLayer(
    {
      id: 'streets',
      type: 'line',
      source: 'streets',
      layout: { 'line-cap': 'round' },
      paint: { 'line-width': 4, 'line-opacity': 0.8, 'line-color': ['interpolate', ['linear'], ['get', 'sun'], 0, INK, 1, '#f2b33d'] },
    },
    firstLabel,
  );
  for (const { id } of ROUTES) {
    map.addSource(id, { type: 'geojson', data: lines[id] ?? { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': GREY }, // select() below styles both lines
    });
    // Amber core on the sunny streets of the route in focus, as strong as the street is sunny.
    map.addLayer({
      id: `${id}-sun`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': SUN, 'line-width': 4, 'line-opacity': ['get', 'sun'] },
    });
  }
  select(selected);
});
