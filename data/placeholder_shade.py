"""TEMPORARY until D5: shade.json and awnings.json keyed to the real graph.json.

    python3 placeholder_shade.py [DIR]      # DIR defaults to web/public/data

Keeps the real sun[] from the current shade.json and sets sunFraction to 1.0 (full sun) for every
edge while the sun is up and 0 below the horizon, so validate.py's cross-check passes and the web
app can load real edges. Shortest and shadiest routes are identical until D5 replaces this with
computed values. awnings.json is reset to no entries (the fixture IDs no longer exist).
Stdlib only.
"""
import json
import sys
from pathlib import Path

DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "web" / "public" / "data"

graph = json.loads((DIR / "graph.json").read_text(encoding="utf-8"))
shade = json.loads((DIR / "shade.json").read_text(encoding="utf-8"))
day = [1.0 if s["alt_deg"] > 0 else 0 for s in shade["sun"]]
shade["sunFraction"] = {e["id"]: list(day) for e in sorted(graph["edges"], key=lambda e: e["id"])}
(DIR / "shade.json").write_text(json.dumps(shade, separators=(",", ":")) + "\n", encoding="utf-8")
(DIR / "awnings.json").write_text(json.dumps({"version": 1, "edges": {}}, indent=2) + "\n", encoding="utf-8")
print(f"placeholder shade.json for {len(graph['edges'])} edges; awnings.json emptied")
