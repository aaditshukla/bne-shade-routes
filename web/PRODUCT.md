# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: hackathon judges at Tanda HackAIthon (Sat 21 Nov 2026, Tanda HQ, 108 Wickham St, Fortitude Valley). They scan a QR code at the venue and open the app cold on their own phone (mostly iPhone Safari), usually standing up, with about 30 seconds to understand what it does. Their job: pick a nearby destination and see why the shadiest route beats the shortest one.
Secondary: Brisbane pedestrians walking on a hot summer day. This is the story the product tells, but the redesign is not optimised for them.

## Product Purpose
Walking directions for a Brisbane summer that keep you in the shade. Success: the judge sees **shortest vs shadiest** with **minutes in the sun** for each, drags the **time slider**, and watches the shadows move and the route change.

## Positioning
It finds shade that height data can't see. Building shadows and street trees come from open data, and a Claude vision pass over Mapillary street photos finds awnings, verandahs, shade sails and covered walkways. Shade is computed per street segment for every 15 minutes of the day.

## Operating Context
- Outdoors or in a bright venue, holding the phone in one hand, on a fresh page load from a QR code.
- Area: about 600 × 600 m around the venue in Fortitude Valley. Day: 2026-11-21, 06:00–18:30 in 15-minute slots. Solar noon is 11:34 at 82° up, so midday shade comes almost entirely from trees and awnings.
- A static app: all data is prefetched JSON and GeoJSON, routing runs in the browser, and there is no live API.

## Capabilities and Constraints
- Pick a destination by tapping the map or a preset chip. The start is always the venue.
- Two routes: shortest (α = 0) and shadiest (α from the "shade hunger" slider, 0–10, default 5). When both have the same sun exposure they merge into one route.
- For each route: minutes in sun, distance, and walking minutes. The headline reads "% less sun for N min extra walk".
- Time slider: 51 slots. Shadow polygons for the slot are overlaid; if a slot's shadow file is missing, streets are coloured by sun fraction instead.
- The 3D view (buildings, trees, sun shadows, both routes) is available on phones and laptops: a 2D/3D toggle under the north button; on a phone the 3D view sits above the bottom sheet.
- Shade hunger stays in the product but is secondary to time.
- Constraints: phone first, one-thumb use, tap targets ≥ 44 px, and safe-area insets on notched iPhones. Basemap from OpenFreeMap through MapLibre. No new dependencies without the team agreeing. Routing (`src/routing/`) and the 3D scene (`src/three/`) are out of scope for visual redesign.
- Preset destinations are placeholders until the real places land.

## Brand Commitments
Name: "Shade Router" (fixed). There is no other identity commitment yet: no logo, palette or deck look to match.

## Evidence on Hand
Real computed data only: sun positions, per-edge sun fractions, shadow polygons, and AI-verified awnings once merged. There are no user testimonials or usage stats, so don't invent them. The stats about the AI pass come from `ai/cache/` logs and belong to the pitch, not this app.

## Product Principles
1. The comparison is the product: shortest vs shadiest, in minutes in the sun, readable in one glance.
2. Time is the magic: moving the slider has to visibly move the shadows and change the answer.
3. Zero instructions: a cold judge should know what to tap without reading a paragraph.
4. Honest numbers: every figure shown comes straight from the computed data.

## Accessibility & Inclusion
Readable in bright outdoor light (strong contrast) and usable one-handed. Route identity must not depend on colour alone.
