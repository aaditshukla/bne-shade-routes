"""A5 - Turn per-image results into per-edge awnings.

Snaps each image side to the nearest edge (within 15 m, in EPSG:7856), then
computes covered_fraction, confidence, kind and image_ids per edge.

Reads web/public/data/graph.json (frozen after ~11:00) and the ai/cache/ logs.
Writes ai/out/awnings.json per contracts/data-formats.md.

Task card: docs/ROADMAP.md -> A5
"""

# TODO: implement per docs/ROADMAP.md task A5
