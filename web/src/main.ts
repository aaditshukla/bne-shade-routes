import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { buildGraph, route, summary, type Route } from './routing/index.ts';
import { nodes, edges, sun, START, DEMO_DEST } from './mock.ts';
import { VENUE } from './ui/presets.ts';
import type { Feature } from 'geojson';

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

const line = (r: Route): Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: r.nodes.map((n) => nodes[n]) },
});

const graph = buildGraph(edges);

const legend = document.getElementById('legend')!;
const drawn = ROUTES.map(({ id, alpha, color }) => {
  const r = route(graph, sun, START, DEMO_DEST, alpha, SLOT)!; // mock grid is connected
  const s = summary(r, sun, SLOT);
  const li = document.createElement('li');
  li.innerHTML = `<span class="swatch" style="background:${color}"></span>${id}: ${Math.round(s.distance_m)} m, ${s.sunMinutes.toFixed(1)} min in sun`;
  legend.append(li);
  return { id, color, r };
});

map.on('load', () => {
  for (const { id, color, r } of drawn) {
    map.addSource(id, { type: 'geojson', data: line(r) });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': id === 'shadiest' ? 6 : 5 },
    });
  }
});
