import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

// shortcut: approximate Fortitude Valley centre; replace with the venue entrance once the bbox is set at 9:00.
const VENUE: [number, number] = [153.0355, -27.4575]; // [lon, lat]

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
