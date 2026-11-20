# Plan-hour decisions (Q1 to Q7) and fixed facts

Source: `docs/ROADMAP.md`, "Decisions to lock at 9:10". All seven took the recommended default.
If one of these changes, tell the team out loud first; nobody's agent edits `contracts/`.

| # | Question | Decision | Affects |
|---|---|---|---|
| Q1 | What does the 2D map draw as moving shadows? | **Yes: `web/public/data/shadows/HHMM.geojson`**, one file per daytime slot (`alt_deg > 0`: 06:00 to 18:15, 50 files), unioned, simplified to 0.5 m, 6-decimal coordinates, roughly 20 to 80 KB each. Fallback if a file is missing: Web colours street edges by `sunFraction`. | Data, Web |
| Q2 | Where do routes start? | **Fixed at the venue entrance** (`graph.json` → `venue`). GPS is a stretch goal. | Web, AI |
| Q3 | When do edge IDs stop changing? | **Deterministic IDs from rounded coordinates** (scheme in `data-formats.md`), **frozen once the real `graph.json` lands** (gate G2). `awnings.json` is keyed by them. | Data, AI |
| Q4 | How does AI avoid waiting on the graph? | **Fetch and classify by bbox**; snap observations to edges only in `aggregate.py`, after the freeze. | AI |
| Q5 | How is the app hosted? | **Vercel Git integration, Root Directory `web`**; the QR points at the production URL. | Web |
| Q6 | Which basemap? | **OpenFreeMap positron** (no API key). | Web |
| Q7 | Which models and how many images? | **`claude-haiku-5-5`** first pass, **`claude-sonnet-5-5`** verifier, **at most 1,500 images**. One person watches `/usage`. | AI |

## Fixed facts the contracts rely on

- **Demo date** 2026-11-21, `Australia/Brisbane` (UTC+10, no DST). 51 slots, every 15 min, 06:00 to 18:30.
- **Venue / bbox.** The venue is the centre of the bbox; the bbox is venue ± 0.00303° lon, ± 0.00271° lat.
  **PROVISIONAL (placeholder, not yet confirmed):** the venue is a stand-in at lon 153.0344, lat −27.4578
  (Fortitude Valley), so the bbox is `[153.03137, -27.46051, 153.03743, -27.45509]`.
  When the real venue is confirmed, Musa updates `CLAUDE.md`, the `bbox` and `venue` in `graph.json`, and
  the fixtures in one commit and says so out loud. `validate.py` checks `graph.json`'s bbox against `CLAUDE.md`.
- **Fixtures.** The files in `contracts/fixtures/` are tiny and hand-made. Their `sunFraction` values are
  hand-shaped to make shortest and shadiest routes differ; they are **not** computed from the fixture buildings
  and trees (the `shadows/` files are). See `contracts/fixtures/README.md`.
