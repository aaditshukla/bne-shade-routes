import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { buildGraph, nearestNode, route, summary } from './routing/index.ts';
import { nodes, edges, sun, START } from './mock.ts';
import { PRESETS, VENUE } from './ui/presets.ts';
import type { FeatureCollection } from 'geojson';

const SLOT = 24; // 12:00
const ROUTES = [
  { id: 'shortest', alpha: 0, color: '#9ca3af' },
  { id: 'shadiest', alpha: 5, color: '#0f766e' },
] as const;

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: VENUE,
  zoom: 16,
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');

const pin = document.createElement('div');
pin.className = 'venue-pin';
pin.setAttribute('aria-label', 'You are here: the venue');
new maplibregl.Marker({ element: pin }).setLngLat(VENUE).addTo(map);

const graph = buildGraph(edges);
const legend = document.getElementById('legend')!;
const destPin = new maplibregl.Marker({ color: '#0f766e' });
// Latest line per route; also used to seed the sources if a pick lands before the map has loaded.
const lines: Record<string, FeatureCollection> = {};

function show(dest: string) {
  destPin.setLngLat(nodes[dest]).addTo(map);
  legend.replaceChildren();
  for (const { id, alpha, color } of ROUTES) {
    const r = route(graph, sun, START, dest, alpha, SLOT);
    lines[id] = {
      type: 'FeatureCollection',
      features: r
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.nodes.map((n) => nodes[n]) } }]
        : [],
    };
    map.getSource<maplibregl.GeoJSONSource>(id)?.setData(lines[id]);
    const li = document.createElement('li');
    if (r) {
      const s = summary(r, sun, SLOT);
      li.innerHTML = `<span class="swatch" style="background:${color}"></span>${id}: ${Math.round(s.distance_m)} m, ${s.sunMinutes.toFixed(1)} min in sun`;
    } else li.textContent = `${id}: no walking route`;
    legend.append(li);
  }
}

function pick(lonlat: [number, number]) {
  const dest = nearestNode(nodes, lonlat);
  if (dest && dest !== START) show(dest);
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
});
