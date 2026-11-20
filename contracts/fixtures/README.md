# Fixtures

Tiny, hand-made, self-consistent files in the formats of `contracts/data-formats.md`. Code against these until real data is on main.
`web/public/data/` starts as a copy of everything here except this README. All IDs are the deterministic ones from the contract
(`validate.py` recomputes them). The venue and bbox are **provisional placeholders** (see `contracts/decisions.md`).

## The ladder

Two parallel 480 m streets joined by five short lanes, 10 nodes and 13 edges, centred on the venue:

```
 N0 ----- N1 ----- N2 ----- N3 ----- N4     North St: 45 m north of South St, shady (sunFraction ~0.2)
 |        |        |        |        |
 R0       R1       R2       R3       R4      lanes: ~46 m, sunFraction 0.35 to 0.5 (R0, R1, R3, R4 have a kink so no two routes tie)
 |        |        |        |        |
 S0 ----- S1 ---- (S2) ---- S3 ----- S4     South St: sunny (~0.95); S2 is the venue entrance
```

Columns are 120 m apart; S2 is the centre of the bbox. Sun is time-dependent: the west half of South St (S0 to S2) is shaded
before about 09:30, the east half (S2 to S4) after about 14:30, and North St gets a bit shadier when the sun is low.
`sunFraction` is 0 at 18:30 (sun below the horizon).

## Shortest vs shadiest from the venue (α = 5, checked with a reference Dijkstra)

| Destination | Node id | 09:00 | 12:00 | 16:30 |
|---|---|---|---|---|
| S0 (west end) | `n_ced9a2e1` | differs | differs | differs |
| S1 | `n_20d716f2` | differs | differs | differs |
| S3 | `n_dd6425fd` | differs | differs | same |
| S4 (east end) | `n_6302646c` | differs | differs | same |

Example at 12:00 to S4: shortest 240 m, about 2.05 sun-min; shadiest 334 m, about 1.12 sun-min (up the lane at the venue, along North St, down the east lane).
Venue node: `n_ec05b307`. Because the east half of South St is shaded after about 14:30, S3 and S4 stop differing at 16:30: the route changes with the time slider.

## What is real and what is not

- `graph.json`, `awnings.json`: hand-made, IDs deterministic.
- `shade.json`: **`sun[]` is real** (NOAA solar position at the venue: 09:00 alt 54.17° az 86.23°; 12:00 alt 80.31°; 16:30 alt 22.70° az 258.52°;
  18:15 alt 0.44°; 18:30 alt −2.62°). **`sunFraction` is hand-shaped** to make routes differ and is *not* derived from the fixture
  buildings and trees. The 3 awnings below are already merged in.
- `buildings.geojson`: 4 buildings (one per `height_source` value, plus one 30 m outside the bbox). `trees.geojson`: 4 trees.
- `shadows/`: **computed** from those buildings and trees (footprint swept by `height / tan(alt)` toward `az + 180°`, unioned,
  clipped to bbox + 200 m, simplified 0.5 m) for all 50 daytime slots, `0600` to `1815`. At 16:30 they point ENE.

## awnings.json (3 hand-labelled edges, all `verified: true`)

| Edge | Kind | covered_fraction | Where |
|---|---|---|---|
| `e_b4273c4aa0` | verandah | 0.6 | South St, S3 to S4 |
| `e_3f032314bf` | awning | 0.8 | North St, N1 to N2 |
| `e_de9a3162ae` | covered_walkway | 0.7 | west lane R0 |

Aadit: copy these keys for the A1 stub (`ai/out/awnings.json`); after the real graph lands, re-key to 3 real edges near the venue.
