// shortcut: approximate Fortitude Valley centre; replace with the venue entrance once the bbox is set at 9:00.
export const VENUE: [number, number] = [153.0355, -27.4575]; // [lon, lat]

// shortcut: placeholder names on mock-grid corners; swap for 5 real places inside the bbox once it's set.
export const PRESETS: { label: string; lonlat: [number, number] }[] = [
  { label: 'Café', lonlat: [153.03763, -27.4575] },
  { label: 'Park', lonlat: [153.03692, -27.4556] },
  { label: 'Station', lonlat: [153.03408, -27.4594] },
  { label: 'Gallery', lonlat: [153.03337, -27.45623] },
  { label: 'Bus stop', lonlat: [153.03621, -27.45877] },
];
