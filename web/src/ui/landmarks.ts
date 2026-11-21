// Landmarks inside the demo bbox, positions from OpenStreetMap (Overpass query, 21 Nov 2026).
// shortcut: hand-picked list in code, no data file; move it into the data pipeline if the team wants more places.
export interface Landmark { name: string; lon: number; lat: number }

export const LANDMARKS: Landmark[] = [
  { name: 'Chinatown Mall', lon: 153.033709, lat: -27.458606 },
  { name: 'Chinatown gate', lon: 153.033157, lat: -27.458175 },
  { name: 'Brunswick Street Mall', lon: 153.034358, lat: -27.457965 },
  { name: 'Centenary Place', lon: 153.031927, lat: -27.460994 },
  { name: 'Kemp Place Park', lon: 153.034568, lat: -27.459719 },
  { name: "All Hallows' School", lon: 153.033636, lat: -27.460996 },
  { name: 'St James College', lon: 153.029951, lat: -27.461081 },
  { name: 'Arethusa College', lon: 153.028766, lat: -27.458147 },
  { name: 'Spring Hill Marketplace', lon: 153.030224, lat: -27.462221 },
];
