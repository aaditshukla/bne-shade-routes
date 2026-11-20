import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre builds its worker URL at runtime, so Vite never copies the file; ?url makes it ship.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';
import { buildGraph, nearestNode, route, summary } from './routing/index.ts';
import { nodes, edges, sun, slots, START } from './mock.ts';
import { PRESETS, VENUE } from './ui/presets.ts';
import { slotAt, slotTime } from './ui/time.ts';
import type { FeatureCollection, LineString } from 'geojson';

let slot = slotAt(new Date());
let alpha = 5; // shade hunger for the shadiest route
let dest: string | null = null;
const WALK_SPEED_MS = 1.3;
const ROUTES = [
  { id: 'shortest', label: 'Shortest', color: '#9ca3af' },
  { id: 'shadiest', label: 'Shadiest', color: '#0f766e' },
] as const;
type RouteId = (typeof ROUTES)[number]['id'];

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

const graph = buildGraph(edges);
const results = document.getElementById('results')!;
const destPin = new maplibregl.Marker({ color: '#0f766e' });
// Latest line per route; also used to seed the sources if a pick lands before the map has loaded.
const lines: Record<string, FeatureCollection> = {};
let selected: RouteId = 'shadiest';

const fmtMin = (m: number) => m.toFixed(1);

function show() {
  const to = dest;
  if (!to) return;
  destPin.setLngLat(nodes[to]).addTo(map);
  const found = ROUTES.map((spec) => {
    const r = route(graph, sun, START, to, spec.id === 'shortest' ? 0 : alpha, slot);
    return { spec, r, s: r && summary(r, sun, slot) };
  });

  const [short, shady] = found;
  // Ties (different streets, same sun) count as one route; show the shorter one in shadiest colours.
  const same = !!short.s && !!shady.s && short.s.sunMinutes - shady.s.sunMinutes < 0.05;
  if (same) {
    shady.r = short.r;
    shady.s = short.s;
    short.r = null;
  }
  for (const { spec, r } of found) {
    lines[spec.id] = {
      type: 'FeatureCollection',
      features: r
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.nodes.map((n) => nodes[n]) } }]
        : [],
    };
    map.getSource<maplibregl.GeoJSONSource>(spec.id)?.setData(lines[spec.id]);
  }
  if (!shady.s || (!same && !short.s)) {
    results.innerHTML = `<p class="headline">No walking route to there.</p>`;
    return;
  }
  const extra = same ? 0 : Math.round(shady.s.distance_m - short.s!.distance_m);
  const headline = same
    ? 'Already the shadiest way.'
    : `Shadiest saves ${fmtMin(short.s!.sunMinutes - shady.s.sunMinutes)} min of sun for ${extra > 0 ? `${extra} m extra` : 'no extra distance'}.`;
  const cards = (same ? [shady] : found).map(({ spec, s }) => `
    <button class="card" data-route="${spec.id}">
      <span class="card-label"><span class="swatch" style="background:${spec.color}"></span>${same ? 'Shortest and shadiest' : spec.label}</span>
      <span class="big">${fmtMin(s!.sunMinutes)}</span> min in sun
      <span class="card-sub">${Math.round(s!.distance_m)} m · ${Math.max(1, Math.round(s!.distance_m / WALK_SPEED_MS / 60))} min walk</span>
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
  const picked = nearestNode(nodes, lonlat);
  if (!picked || picked === START) return;
  dest = picked;
  show();
  // Frame both routes on a new pick (not on slider moves, so the map doesn't jump while dragging).
  const bounds = new maplibregl.LngLatBounds();
  for (const fc of Object.values(lines))
    for (const f of fc.features) for (const c of (f.geometry as LineString).coordinates) bounds.extend(c as [number, number]);
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
  const alt = slots[slot].alt_deg;
  timeLabel.textContent = `${slotTime(slot)} · ${alt > 0 ? `sun ${Math.round(alt)}° up` : 'sun down'}`;
  alphaLabel.textContent = String(alpha);
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
