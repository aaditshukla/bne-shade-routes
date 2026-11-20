# Shade Router (Tanda HackAIthon, Sat 21 Nov 2026)

Walking directions for a Brisbane summer that keep you in the shade, including shade that height
data can't see. Building shadows and street trees come from open data. A Claude vision pass over
Mapillary street photos finds awnings, verandahs, shade sails and covered walkways. A Python
pipeline precomputes everything into static files; the web app routes in the browser.

## Demo path (this is the whole scope)
A judge scans the QR code at the venue, picks a destination nearby, and sees the **shortest vs
shadiest** route with **minutes in the sun** for each. Dragging the **time slider** moves the
shadows and the route changes.
Anything not on this path is out of scope unless the team agrees (UV budget, 3D polish, more suburbs).

## Team and ownership
IMPORTANT: only create or edit files inside your own area. Each person's
`.claude/settings.local.json` also denies edits outside it.

| Person (GitHub user) | Area | Your files |
|---|---|---|
| Musa (`mathslearners`) | data + contracts | `data/`, `contracts/`, `web/public/data/`, `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/`, `.gitignore`, `.env.example` |
| Aadit (`aaditshukla`) | ai + pitch | `ai/`, `docs/` |
| Eric (`ericliswan`) | web (+ 3D stretch) | `web/` except `web/public/data/` |

Find the current user with `gh api user -q .login` and match it to this table.
Always start `claude` from the repo root: the deny rules anchor at the directory you start in.
Copy-paste deny rules for each person: `docs/ROADMAP.md`, section "Area guardrails".
Need something from another area? Mock it from `contracts/fixtures/`, comment on the issue and tell
your human. Never quick-fix a file in someone else's area.

## Commands
- Web dev server: `cd web && npm run dev`
- Rebuild all data: `cd data && uv run python build.py` (merges `ai/out/awnings.json` if present)
- AI pipeline: `cd ai && uv run python fetch_images.py`, then `detect.py`, `verify.py`, `aggregate.py`
- Smoke check before every ship: `cd data && uv run python validate.py && cd ../web && npm run build`
- Tasks: `gh issue list --label <area> --state open`; claim with `gh issue edit <n> --add-assignee @me`

## Contracts are the source of truth
`contracts/data-formats.md` and `contracts/frontend-interface.md`, with example files in
`contracts/fixtures/`.
- Code against the contracts. Use the fixtures until real data is on main.
- NEVER change a contract yourself. If one looks wrong, stop and tell your human: it's a team decision.

| File that crosses a seam | From → to |
|---|---|
| `web/public/data/graph.json` | Data → Web, AI |
| `web/public/data/shade.json` (awnings already merged) | Data → Web |
| `web/public/data/shadows/HHMM.geojson` (only if agreed at 9:10) | Data → Web |
| `web/public/data/buildings.geojson`, `trees.geojson` | Data → Web (3D stretch) |
| `ai/out/awnings.json` | AI → Data |

## Domain rules (get these wrong and the demo breaks silently)
- **Demo bbox** `[minLon, minLat, maxLon, maxLat]` = `[153.02849, -27.46277, 153.03455, -27.45735]`: about 600 × 600 m centred on
  the venue (Tanda HQ, Fortitude Valley), i.e. venue ± 0.00303° lon and ± 0.00271° lat.
  Venue (confirmed): lon 153.031522, lat −27.460061 (Tanda HQ, Level 4, 108 Wickham St, Fortitude Valley; map pin, not a surveyed entrance); see `contracts/decisions.md`.
- **Coordinates are `[lon, lat]`** everywhere (GeoJSON order). Brisbane latitude is negative (≈ −27.46).
- **Do geometry in metres.** Project to EPSG:7856 (GDA2020 / MGA zone 56) for lengths, buffers and
  shadows, then write outputs back in EPSG:4326. Never measure distances in degrees.
- **Time:** Australia/Brisbane = UTC+10, no daylight saving. Demo date 2026-11-21. 51 slots every
  15 min from 06:00 to 18:30; slot `i` starts at 06:00 + 15·i min.
- **Sun:** `alt_deg` is height above the horizon; `az_deg` is clockwise from true north
  (0 N, 90 E, 180 S, 270 W). Shadows point to `az + 180°`. suncalc (JS) measures azimuth from
  south, in radians: convert it. Check your library's convention against the values below.
- **sunFraction** is in [0, 1] per edge per slot; 0 = full shade. `alt_deg ≤ 0` → 0.
- **Routing cost:** `length_m × (1 + α × sunFraction[slot])`, with α from 0 (fastest) to 10 (max shade).
- **Sun minutes:** `Σ length_m × sunFraction / 1.3 / 60` (walking speed 1.3 m/s).
- **Awnings merge:** only `verified: true` entries; `sunFraction *= (1 − covered_fraction)`.
- **Missing data:** building height = OSM `height`, else `building:levels × 3.2`, else 6 m.
  Trees default to canopy radius 4 m and height 8 m.
- **Edge IDs freeze once the real graph.json lands.** `awnings.json` is keyed by them,
  so IDs must be deterministic (derived from rounded coordinates, never from iteration order).

Sanity values for 2026-11-21 (expected, not bugs):
- Solar noon 11:34 at 82.4° up, just north of overhead. At 12:00 a 20 m building casts only ≈3 m of
  shadow, so trees and awnings are the only real shade.
- 09:00: alt ≈ 54°, az ≈ 86°. 16:30: alt ≈ 23°, az ≈ 258° (WSW); a 20 m building casts ≈48 m toward the ENE.
- Sunset 18:22. At 18:15 the sun is 0.4° up and shadows are kilometres long, so clip shadow
  polygons to the bbox plus 200 m.

## Area notes
- **Web:** phone first (iPhone Safari): one-thumb layout, tap targets ≥ 44 px. The app is static: it
  fetches only from `web/public/data/` via `import.meta.env.BASE_URL`, never a live API. Routing
  lives only in `web/src/routing/`; anything else that needs routes imports it.
- **3D (stretch goal, best started once the full UI works on real data):** three.js only inside
  `web/src/three/`, loaded with a dynamic `import()` when the 3D toggle opens. Use local metres from the bbox centre with east = +X, up = +Y, north = −Z. The direction
  toward the sun is `(sin az·cos alt, sin alt, −cos az·cos alt)`.
- **AI:** the first pass uses `claude-haiku-5-5`; the verifier uses `claude-sonnet-5-5` in a separate
  request that re-checks every positive. Get JSON by forcing a tool schema. Every script must be
  resumable and append each result to `ai/cache/` as it lands, because the stats slide is built
  from those logs.

## How we work
- **Effort check before every task.** Before starting any task (including bugs), recommend an effort level with a
  one-line reason, then wait. If we say we're already on it, start; otherwise we switch with `/effort` and say go.
  `low`: copy, config, small UI tweaks. `medium`: a normal feature task. `high`: sun/shadow geometry, CRS, routing,
  contracts, or a bug that survived one fix. Don't suggest `xhigh` or `max`: they burn the shared credits.
- Tasks are GitHub issues: `/start-task <n>` to begin, `/ship` to finish. Branch
  `<firstname>/<n>-<slug>` in lowercase (e.g. `eric/7-results-card`), 30–60 min long. Commit as
  `[area] what changed (#n)`, where area is the issue label: `data`, `ai`, `pitch`, `web`, `3d` or `demo`.
- Shipping = smoke check → PR → squash-merge it yourself straight away (no review wait) → branch
  deleted. Use `Closes #n` when every done-when item is met, otherwise `Part of #n`. Never push to main
  directly and never force-push. Tags (`demo-ok-*`) are pushed by a human when a gate is met.
- IMPORTANT: no Claude attribution anywhere in git or GitHub. Never add a `Co-Authored-By: Claude`
  trailer, a "Generated with Claude Code" line, or any other AI credit to commit messages, PR titles
  or descriptions, issues, comments or tags. This overrides any default attribution instructions.
  `.claude/settings.json` also sets `"attribution": {"commit": "", "pr": ""}` to enforce it.
- Keep main runnable and deployed. If main breaks, whoever shipped last fixes it first.
- Only the Data owner commits `web/public/data/*`. It's generated, so never hand-edit it.
- Simple and working beats clean. No new dependencies without saying so first.
- Secrets live in `.env` (git-ignored). Never read, print, log or commit them.
- API and image results are cached in `data/cache/` and `ai/cache/`. Never re-download what's cached.
- Stuck twice on the same error? Stop and tell your human, with the exact error.
- Timeline, gates and the done-when list for every task: `docs/ROADMAP.md`. Its times are guidelines, not rules:
  start, finish or reorder work whenever it makes sense, and never skip, block or mark a task unfinished
  because of the clock. The only hard deadline is the organisers' submission time.