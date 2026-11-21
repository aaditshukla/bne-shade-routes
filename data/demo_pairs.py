"""Shortest vs shadiest numbers for the demo destinations (stdlib only).

Same rules as web/src/routing: cost = length_m * (1 + alpha * sunFraction[slot]), start at the venue
node, sun minutes = sum(length_m * sunFraction) / 1.3 / 60. Run it again after the awnings merge:
    cd data && python3 demo_pairs.py
"""
import heapq, json, pathlib

D = pathlib.Path(__file__).resolve().parent.parent / "web" / "public" / "data"
ALPHA = 5
SLOTS = {"09:00": 12, "12:00": 24, "16:30": 42}
# (label, node id) in the order they should appear in the preset chips. Intersections, not POIs.
PAIRS = [
    ("Duncan St & Wickham St", "n_f677a08c"),
    ("Boundary St & Dodge Ln", "n_5abc6f9c"),
    ("Boundary St & Ivory St", "n_a3c07730"),
    ("Barry Pde & Gipps St", "n_a6498936"),
    ("Macrossan St & Queen St", "n_8e224ba7"),
]

g = json.load(open(D / "graph.json"))
shade = json.load(open(D / "shade.json"))["sunFraction"]
adj = {}
for e in g["edges"]:
    adj.setdefault(e["a"], []).append((e["b"], e))
    adj.setdefault(e["b"], []).append((e["a"], e))


def route(src, dst, alpha, slot):
    dist, prev, heap = {src: 0.0}, {}, [(0.0, src)]
    while heap:
        d, n = heapq.heappop(heap)
        if n == dst:
            break
        if d > dist[n]:
            continue
        for m, e in adj[n]:
            nd = d + e["length_m"] * (1 + alpha * shade.get(e["id"], [1] * 51)[slot])
            if nd < dist.get(m, 1e18):
                dist[m], prev[m] = nd, (n, e)
                heapq.heappush(heap, (nd, m))
    edges = []
    while dst != src:
        dst, e = prev[dst]
        edges.append(e)
    return edges[::-1]


def summary(edges, slot):
    m = sum(e["length_m"] for e in edges)
    sun = sum(e["length_m"] * shade.get(e["id"], [1] * 51)[slot] for e in edges)
    return m, sun / 1.3 / 60


def streets(edges):
    out = []
    for e in edges:
        n = e.get("name")
        if n and (not out or out[-1] != n):
            out.append(n)
    return " > ".join(out)


if __name__ == "__main__":
    venue = g["venue"]["node"]
    for label, node in PAIRS:
        print(f"\n{label}  {node}")
        for t, s in SLOTS.items():
            a, b = route(venue, node, 0, s), route(venue, node, ALPHA, s)
            (ma, sa), (mb, sb) = summary(a, s), summary(b, s)
            print(f"  {t}  shortest {ma:.0f} m {sa:.1f} sun-min | shadiest {mb:.0f} m {sb:.1f} sun-min"
                  f" | saves {sa - sb:.1f} (+{(mb / ma - 1) * 100:.0f}% distance) | via {streets(b)}")
