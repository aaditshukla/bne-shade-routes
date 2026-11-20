import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre builds its worker URL at runtime, so Vite never copies the file; ?url makes it ship.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';
import { createRouter, loadData, type Graph, type ShadeData } from './routing/index.ts';
import { PRESETS } from './ui/presets.ts';
import { slotAt, slotTime } from './ui/time.ts';
import { loadShadows } from './ui/shadows.ts';
import type { FeatureCollection } from 'geojson';

let slot = slotAt(new Date());
let alpha = 5; // shade hunger for the shadiest route
let dest: string | null = null;
const ROUTES = [
  { id: 'shortest', label: 'Shortest', color: '#9ca3af' },
  { id: 'shadiest', label: 'Shadiest', color: '#0f766e' },
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
const router = createRouter(graph, shade);
const START = graph.venue.node;
const VENUE: [number, number] = [graph.venue.lon, graph.venue.lat];
const nodeAt = new Map(graph.nodes.map((n) => [n.id, [n.lon, n.lat] as [number, number]]));

maplibregl.setWorkerUrl(workerUrl);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: VENUE,
  zoom: 16,
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
// Keep the venue centred in the part of the map the bottom sheet doesn't cover.
const sheet = document.getElementById('sheet')!;
new ResizeObserver(() => map.setPadding({ top: 0, left: 0, right: 0, bottom: sheet.offsetHeight })).observe(sheet);

const pin = document.createElement('div');
pin.className = 'venue-pin';
pin.setAttribute('aria-label', 'You are here: the venue');
new maplibregl.Marker({ element: pin }).setLngLat(VENUE).addTo(map);

const destPin = new maplibregl.Marker({ color: '#0f766e' });
// Latest line per route; also used to seed the sources if a pick lands before the map has loaded.
const lines: Record<string, FeatureCollection> = {};
let selected: RouteId = 'shadiest';

const fmtMin = (m: number) => m.toFixed(1);

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

function show() {
  const to = dest;
  if (!to) return;
  destPin.setLngLat(nodeAt.get(to)!).addTo(map);
  const found = ROUTES.map((spec) => {
    const r = router.route(START, to, spec.id === 'shortest' ? 0 : alpha, slot);
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
  for (const { spec, r } of found) {
    lines[spec.id] = {
      type: 'FeatureCollection',
      features: r
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.coords } }]
        : [],
    };
    map.getSource<maplibregl.GeoJSONSource>(spec.id)?.setData(lines[spec.id]);
  }
  if (!shady.s || (!same && !short.s)) {
    results.innerHTML = `<p class="headline">No walking route to there.</p>`;
    return;
  }
  // Contract: extra minutes from walk_min, "% less sun" from sun_min.
  const extra = same ? 0 : Math.round(shady.s.walk_min - short.s!.walk_min);
  const less = same ? 0 : Math.round((1 - shady.s.sun_min / short.s!.sun_min) * 100);
  const headline = same
    ? 'Already the shadiest way.'
    : `Shadiest: ${less}% less sun for ${extra > 0 ? `${extra} min extra walk` : 'no extra walk'}.`;
  const cards = (same ? [shady] : found).map(({ spec, s }) => `
    <button class="card" data-route="${spec.id}">
      <span class="card-label"><span class="swatch" style="background:${spec.color}"></span>${same ? 'Shortest and shadiest' : spec.label}</span>
      <span class="big">${fmtMin(s!.sun_min)}</span> min in sun
      <span class="card-sub">${Math.round(s!.distance_m)} m · ${Math.max(1, Math.round(s!.walk_min))} min walk</span>
    </button>`);
  results.innerHTML = `<p class="headline">${headline}</p><div class="cards">${cards.join('')}</div>`;
  select(same ? 'shadiest' : selected);
}

// Highlight one route: its card is pressed and its line sits on top at full strength.
function select(id: RouteId) {
  selected = id;
  for (const c of results.querySelectorAll('[data-route]')) c.setAttribute('aria-pressed', String(c.getAttribute('data-route') === id));
  if (!map.getLayer(id)) return; // map still loading; the load handler applies it
  for (const { id: other } of ROUTES) map.setPaintProperty(other, 'line-opacity', other === id ? 1 : 0.4);
  map.moveLayer(id);
}

results.onclick = (e) => {
  const card = (e.target as Element).closest('[data-route]');
  if (card) select(card.getAttribute('data-route') as RouteId);
};

function pick(lonlat: [number, number]) {
  const picked = router.nearestNode(...lonlat);
  if (picked === START) return;
  dest = picked;
  show();
  // Frame both routes on a new pick (not on slider moves, so the map doesn't jump while dragging).
  const bounds = new maplibregl.LngLatBounds();
  for (const fc of Object.values(lines))
    for (const f of fc.features) if (f.geometry.type === 'LineString') for (const c of f.geometry.coordinates) bounds.extend(c as [number, number]);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: { top: 80, bottom: 48, left: 48, right: 48 }, maxZoom: 17 }); // top leaves room for the pin
}

// Preset chips: aria-pressed marks the active one; a map tap clears it.
const chips = document.getElementById('presets')!;
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.setAttribute('aria-pressed', 'false');
  b.onclick = () => {
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c === b));
    pick(p.lonlat);
  };
  chips.append(b);
}

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
  showShadows();
  show();
}
timeInput.value = String(slot);
timeInput.oninput = alphaInput.oninput = readSliders;
readSliders();

map.on('click', (e) => {
  for (const c of chips.children) c.setAttribute('aria-pressed', 'false');
  pick([e.lngLat.lng, e.lngLat.lat]);
});

map.on('load', () => {
  // Shadows sit under the basemap's labels; routes go on top of everything.
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addSource('shadows', { type: 'geojson', data: shadowData });
  map.addLayer({ id: 'shadows', type: 'fill', source: 'shadows', paint: { 'fill-color': '#1e293b', 'fill-opacity': 0.22 } }, firstLabel);
  map.addSource('streets', { type: 'geojson', data: streetData });
  map.addLayer(
    {
      id: 'streets',
      type: 'line',
      source: 'streets',
      layout: { 'line-cap': 'round' },
      paint: { 'line-width': 4, 'line-opacity': 0.8, 'line-color': ['interpolate', ['linear'], ['get', 'sun'], 0, '#64748b', 1, '#f59e0b'] },
    },
    firstLabel,
  );
  for (const { id, color } of ROUTES) {
    map.addSource(id, { type: 'geojson', data: lines[id] ?? { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': id === 'shadiest' ? 6 : 5 },
    });
  }
  select(selected);
});
