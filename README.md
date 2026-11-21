# Shade Router

Walking directions for a Brisbane summer that keep you in the shade, including shade that height data can't see.

Built at the Tanda HackAIthon (21 Nov 2026) in Fortitude Valley.

## The demo

Scan the QR code, pick a start and destination around the venue like in any maps app (search a street or junction, tap the map, drag a pin or use your location), and compare the **shortest** and **shadiest** walking routes, each with its **minutes in the sun**. Drag the time slider and the shadows move and the route changes.

## How it works

1. **Sun.** Sun height and direction for every 15 minutes from 06:00 to 18:30 on the demo day.
2. **Buildings.** OpenStreetMap footprints and heights, swept into shadows for each time slot.
3. **Trees.** Street and park trees as canopy discs. At midday these are most of the shade there is.
4. **Awnings.** Claude looks at Mapillary street photos to find awnings, verandahs, shade sails and covered walkways. Haiku makes a first pass and Sonnet re-checks every positive.
5. **Routing.** Each street segment gets a sun fraction per time slot. The browser runs Dijkstra with cost `length × (1 + α × sunFraction)`, where α is how much you care about shade.

A Python pipeline precomputes everything into static files, so the web app needs no server.

## Repo layout

| Folder | What |
|---|---|
| `data/` | Python pipeline: walk graph, buildings, trees, shadows, `shade.json` |
| `ai/` | Mapillary fetch, Claude vision pass and verifier, per-edge awnings |
| `web/` | The phone-first web app; routing runs in the browser |
| `contracts/` | File formats shared between the three parts |
| `docs/` | Roadmap, pitch and demo notes |

## Running it

```sh
cd web && npm run dev                  # web app
cd data && uv run python build.py      # rebuild all data
```

Copy `.env.example` to `.env` for the AI pipeline's API keys.

## Team

Musa ([@mathslearners](https://github.com/mathslearners)): data · Aadit ([@aaditshukla](https://github.com/aaditshukla)): AI and pitch · Eric ([@ericliswan](https://github.com/ericliswan)): web

## Data

Map data © OpenStreetMap contributors (ODbL). Street imagery from Mapillary (CC BY-SA).
