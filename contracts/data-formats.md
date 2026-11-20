# Data formats (source of truth for every file that crosses a seam)

Decisions behind this file: `contracts/decisions.md`. Example files: `contracts/fixtures/`.
Checker: `cd data && uv run python validate.py [path]`. If this file and the checker disagree, tell Musa.

| File | Producer → consumers |
|---|---|
| `web/public/data/graph.json` | Data → Web, AI |
| `web/public/data/shade.json` (verified awnings already merged) | Data → Web |
| `web/public/data/shadows/HHMM.geojson` | Data → Web |
| `web/public/data/buildings.geojson`, `trees.geojson` | Data → Web (3D stretch) |
| `ai/out/awnings.json` | AI → Data (merged into `shade.json` by `build.py`) |

## Conventions (all files)

- **Coordinates are `[lon, lat]`** (GeoJSON order), degrees, WGS84 (EPSG:4326), rounded to **6 decimals**.
  Brisbane longitude is about 153.03 and latitude about −27.46 (negative). A pair that looks like `[-27.46, 153.03]` is swapped.
- **bbox** is `[minLon, minLat, maxLon, maxLat]`. The demo bbox is in `CLAUDE.md` and repeated in `graph.json`.
- **Geometry is done in metres.** Project to EPSG:7856 (GDA2020 / MGA zone 56) for lengths, buffers and shadows,
  then write results back in EPSG:4326. Never measure in degrees.
- **Slots.** `i` in `0..50`; slot `i` starts at `06:00 + 15·i` minutes, Australia/Brisbane (UTC+10). Slot 0 = 06:00,
  slot 12 = 09:00, slot 24 = 12:00, slot 42 = 16:30, slot 50 = 18:30. Exactly 51 slots. "Daytime" slots are those with `alt_deg > 0` (0 to 49 on the demo date).
- **Sun.** `alt_deg` is degrees above the horizon. `az_deg` is clockwise from true north (0 N, 90 E, 180 S, 270 W).
  Shadows point toward `az_deg + 180°`.
- **sunFraction** is in `[0, 1]` per edge per slot; 0 = full shade, 1 = full sun. When `alt_deg ≤ 0` it is 0.
- JSON files are UTF-8, no comments. Extra keys are ignored by readers; missing required keys are a bug.

## Deterministic IDs (frozen once the real `graph.json` lands, Q3)

IDs are derived from rounded coordinates, never from iteration order, so rebuilding never renames anything.

```python
import hashlib
def key(lon, lat):  return f"{lon:.6f},{lat:.6f}"                 # the 6-decimal coordinates stored in the file
def sha(s, n):      return hashlib.sha1(s.encode("utf-8")).hexdigest()[:n]
node_id = "n_" + sha(key(lon, lat), 8)
# Orient the edge geometry so its first vertex has the smaller key (plain string comparison) than its last.
edge_id = "e_" + sha(";".join(key(lon, lat) for lon, lat in geometry), 10)
```

- A node ID depends only on the node's coordinates; an edge ID only on its oriented vertex list.
- Anyone can recompute every ID from `graph.json` alone (`validate.py` does). Builders must assert IDs are unique and fail rather than patch a collision.
- Splitting edges into ≤ 30 m pieces happens **before** the freeze: changing the split changes the IDs. After the freeze, never re-split, simplify or re-round the graph.
- If the graph ever has to change after the freeze, tell AI and Web out loud first: every awning key is lost otherwise.

## `graph.json`

Undirected walk graph for the bbox; the largest connected component only.

```jsonc
{
  "version": 1,
  "bbox": [153.03137, -27.46051, 153.03743, -27.45509],     // [minLon, minLat, maxLon, maxLat]; must equal CLAUDE.md
  "venue": { "name": "Venue entrance", "lon": 153.0344, "lat": -27.4578, "node": "n_1a2b3c4d" },  // routes start here (Q2); node is a nodes[].id at this exact point
  "nodes": [
    { "id": "n_1a2b3c4d", "lon": 153.0344, "lat": -27.4578, "name": "optional label" }
  ],
  "edges": [
    {
      "id": "e_0123456789",          // see Deterministic IDs
      "a": "n_1a2b3c4d",             // endpoint whose key is smaller; geometry[0] is a's [lon, lat]
      "b": "n_5e6f7a8b",             // geometry[last] is b's [lon, lat]
      "length_m": 120.23,            // metres along the geometry (EPSG:7856); > 0
      "name": "optional street name",
      "geometry": [[153.0344, -27.4578], [153.03561, -27.4578]]   // [lon, lat] polyline, ≥ 2 vertices, inside bbox
    }
  ]
}
```

| Key | Type | Notes |
|---|---|---|
| `version` | integer | `1` |
| `bbox` | 4 numbers | `minLon < maxLon`, `minLat < maxLat` |
| `venue` | object | `name` string, `lon`/`lat` numbers inside bbox, `node` an existing node id |
| `nodes[].id` | string | `n_` + 8 hex; unique |
| `nodes[].lon`, `.lat` | number | inside bbox |
| `nodes[].name` | string, optional | |
| `edges[].id` | string | `e_` + 10 hex; unique |
| `edges[].a`, `.b` | string | existing node ids, `a ≠ b`; edges are undirected, one record per street piece |
| `edges[].length_m` | number | > 0, within ~2% of the geometry's geodesic length |
| `edges[].name` | string, optional | |
| `edges[].geometry` | `[lon, lat][]` | first/last vertex equal the `a`/`b` node coordinates |

The real graph should split edges to ≤ 30 m (D2). The fixture edges are longer; readers must not assume a maximum.

## `shade.json`

Per-edge sun fraction for each of the 51 slots, with verified awnings already merged:
`sunFraction *= (1 − covered_fraction)` for every `verified: true` entry in `awnings.json`.

```jsonc
{
  "version": 1,
  "date": "2026-11-21",
  "tz": "Australia/Brisbane",
  "slot_minutes": 15,
  "slots": ["06:00", "06:15", /* ... */ "18:30"],            // exactly 51 "HH:MM" strings
  "sun": [ { "alt_deg": 12.4, "az_deg": 98.1 }, /* ... */ ], // 51 entries, same order as slots
  "sunFraction": {
    "e_0123456789": [0.9, 0.9, /* ... */ 0.0]                // 51 numbers in [0, 1], every graph edge present
  }
}
```

- `sun[i]` is the sun at slot `i`; `alt_deg` in `[-90, 90]`, `az_deg` in `[0, 360)`, 2 decimals.
- Every edge id in `graph.json` has an entry in `sunFraction`, and every key of `sunFraction` is an edge id in `graph.json`. Values have 2 decimals.
- `sunFraction[id][i]` is 0 for every slot with `alt_deg ≤ 0`.
- Routing cost: `length_m × (1 + α × sunFraction[id][slot])`, α from 0 (fastest) to 10 (max shade).
  Sun minutes: `Σ length_m × sunFraction / 1.3 / 60`.
- Sanity values for 2026-11-21 (`validate.py` checks them): 09:00 alt ≈ 54°, az ≈ 86°; 16:30 alt ≈ 22.7°, az ≈ 258.5°; 18:15 alt ≈ 0.4° (sun still up); 18:30 alt < 0.

## `shadows/HHMM.geojson`

One file per daytime slot, named by the slot's start time without a colon: `0600.geojson` to `1815.geojson` (50 files).
No file for slots where `alt_deg ≤ 0` (`1830`).

- A GeoJSON `FeatureCollection`. The slot's shadows from buildings and trees are **unioned** (no overlapping polygons) into `Polygon` / `MultiPolygon` features (typically a single `MultiPolygon`; an empty `features` array is valid).
- Coordinates `[lon, lat]`, 6 decimals, simplified to a 0.5 m tolerance (in EPSG:7856), rings closed.
- **Clipped to the bbox plus 200 m**: near sunset shadows are kilometres long.
- `properties` is `{}` (nothing required). Target size 20 to 80 KB per file; keep `web/public/data` under about 5 MB total.

## `buildings.geojson`

Footprints for the bbox plus a 100 m buffer (buildings just outside still shade streets inside).

```jsonc
{ "type": "FeatureCollection", "features": [{
  "type": "Feature",
  "properties": { "id": "way/123456", "height_m": 28.0, "height_source": "osm" },
  "geometry": { "type": "Polygon", "coordinates": [[[153.0334, -27.4574], /* ... closed ring ... */ ]] }
}]}
```

| Key | Type | Notes |
|---|---|---|
| `properties.id` | string | unique |
| `properties.height_m` | number | > 0 |
| `properties.height_source` | `"osm"` \| `"levels"` \| `"default"` | OSM `height` tag; else `building:levels × 3.2`; else `default` = 6 m |
| `geometry` | `Polygon` \| `MultiPolygon` | closed rings, `[lon, lat]`, inside bbox + 100 m |

## `trees.geojson`

Street and park trees as points. Defaults when unknown: canopy radius 4 m, height 8 m.

```jsonc
{ "type": "FeatureCollection", "features": [{
  "type": "Feature",
  "properties": { "id": "t1", "canopy_radius_m": 5.5, "height_m": 11.0, "source": "osm" },
  "geometry": { "type": "Point", "coordinates": [153.0329, -27.4574] }
}]}
```

| Key | Type | Notes |
|---|---|---|
| `properties.id` | string | unique |
| `properties.canopy_radius_m` | number | > 0, metres |
| `properties.height_m` | number | > 0, metres |
| `properties.source` | string, optional | where the record came from (e.g. `bcc`, `osm`) |
| `geometry` | `Point` | `[lon, lat]`, inside bbox |

## `ai/out/awnings.json`

Written by `ai/aggregate.py`, keyed by frozen edge id. Merged into `shade.json` by `data/build.py`;
the web app never loads it.

```jsonc
{
  "version": 1,
  "edges": {
    "e_0123456789": {
      "kind": "awning",              // "awning" | "verandah" | "shade_sail" | "covered_walkway"
      "covered_fraction": 0.8,       // 0..1 of the edge's length covered
      "confidence": 0.9,             // 0..1, mean model confidence
      "verified": true,              // true only when the Sonnet verifier agreed
      "image_ids": ["123456789"]     // Mapillary image ids (strings) that showed the cover; [] for hand-labelled stubs
    }
  }
}
```

- Every key must be an edge id in `graph.json`.
- Only `verified: true` entries are merged: `sunFraction *= (1 − covered_fraction)`, for every slot.
- Trees do not count as cover here (they are in `trees.geojson`).
