#!/usr/bin/env python3
"""D7: one command that rebuilds every data file from cache, merges awnings, prints sizes, validates.

    cd data && uv run python build.py                          # real build into web/public/data/
    uv run python build.py --out-dir DIR                       # build somewhere else (scratch)
    uv run python build.py --fixtures --out-dir DIR            # PLACEHOLDER inputs: copy graph/buildings/trees from
                                                               #   contracts/fixtures/ instead of building them
    uv run python build.py --awnings FILE                      # other awnings.json (default ai/out/awnings.json)

Steps, in order (each reads its cache in data/cache/ and only downloads what is missing):
  1. graph       build_graph.py   -> graph.json
  2. buildings   buildings.py     -> buildings.geojson      (needs `--out`; draft PR #7, not on main yet)
  3. trees       trees.py         -> trees.geojson
  4. shadows     shadows.py       -> raw shade (cache/shade_raw.json) + shadows/HHMM.geojson
  5. shade       merge verified awnings: sunFraction *= (1 - covered_fraction), for every slot -> shade.json
  6. sizes       print each file's size and the total (target: under about 5 MB)
  7. validate    validate.py OUT_DIR (the exit code is validate's)

Only `verified: true` awnings are merged. Without an awnings file, shade.json is the raw shadow output.
--fixtures refuses to write into web/public/data/ so placeholder output can never replace real data.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE = HERE / "cache"
PUBLIC = ROOT / "web" / "public" / "data"
FIXTURES = ROOT / "contracts" / "fixtures"
DEFAULT_AWNINGS = ROOT / "ai" / "out" / "awnings.json"
RAW_SHADE = CACHE / "shade_raw.json"
SIZE_BUDGET = 5 * 1024 * 1024


def run(label, *cmd):
    print(f"\n== {label}: {' '.join(str(c) for c in cmd[1:])}", flush=True)
    r = subprocess.run([sys.executable, *map(str, cmd)], cwd=HERE)
    if r.returncode != 0:
        sys.exit(f"build.py: step '{label}' failed (exit {r.returncode}); stopping")


def step_script(name, label):
    p = HERE / name
    if not p.is_file():
        sys.exit(f"build.py: {name} is missing (step '{label}'). It is not on this branch yet; merge it first.")
    return p


def merge_awnings(raw_path, awnings_path, out_path):
    """Apply verified awnings to the raw shade file and write shade.json. Returns a printable summary."""
    shade = json.loads(raw_path.read_text(encoding="utf-8"))
    sf = shade["sunFraction"]
    if awnings_path is None:
        out_path.write_text(json.dumps(shade, separators=(",", ":")) + "\n", encoding="utf-8")
        return "no awnings file: shade.json is the raw shadow output"
    aw = json.loads(awnings_path.read_text(encoding="utf-8"))
    entries = aw.get("edges", {})
    verified = {eid: v for eid, v in entries.items() if v.get("verified") is True}
    unknown = sorted(eid for eid in verified if eid not in sf)
    if unknown:
        sys.exit(f"build.py: {len(unknown)} verified awning edge ids are not in graph.json (first: {unknown[0]}). "
                 "Edge ids are frozen once the real graph lands: is awnings.json for another graph?")
    changed = 0
    for eid, v in verified.items():
        keep = 1.0 - float(v["covered_fraction"])
        new = [round(x * keep, 2) for x in sf[eid]]
        changed += new != sf[eid]
        sf[eid] = new
    out_path.write_text(json.dumps(shade, separators=(",", ":")) + "\n", encoding="utf-8")
    return (f"{awnings_path}: {len(entries)} entries, {len(verified)} verified merged "
            f"({len(entries) - len(verified)} unverified ignored), {changed} edges changed")


def kb(n):
    return f"{n / 1024:8.1f} KB"


def print_sizes(out_dir):
    print(f"\n== sizes in {out_dir}")
    total = 0
    for p in sorted(out_dir.iterdir()):
        if p.is_file():
            total += p.stat().st_size
            print(f"  {p.name:<20}{kb(p.stat().st_size)}")
    sd = out_dir / "shadows"
    if sd.is_dir():
        files = sorted(sd.glob("*.geojson"))
        sizes = [f.stat().st_size for f in files]
        total += sum(sizes)
        if sizes:
            print(f"  {'shadows/':<20}{kb(sum(sizes))}  ({len(files)} files, {kb(min(sizes)).strip()} to {kb(max(sizes)).strip()} each)")
    print(f"  {'TOTAL':<20}{kb(total)}  ({total / 1024 / 1024:.2f} MB)")
    if total > SIZE_BUDGET:
        print(f"WARNING: total is over the ~5 MB budget for phones ({total / 1024 / 1024:.2f} MB)", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default=str(PUBLIC), help="output data directory (default web/public/data)")
    ap.add_argument("--fixtures", action="store_true",
                    help="PLACEHOLDER: copy graph/buildings/trees from contracts/fixtures/ instead of building them")
    ap.add_argument("--awnings", default=None, help=f"awnings.json to merge (default {DEFAULT_AWNINGS.relative_to(ROOT)} if present)")
    args = ap.parse_args()

    out_dir = Path(args.out_dir).resolve()
    if args.fixtures and out_dir == PUBLIC.resolve():
        sys.exit("build.py: --fixtures refuses to write into web/public/data/ (placeholder output must not replace real data). "
                 "Use --out-dir with a scratch directory.")
    awnings = Path(args.awnings) if args.awnings else (DEFAULT_AWNINGS if DEFAULT_AWNINGS.is_file() else None)
    if args.awnings and not awnings.is_file():
        sys.exit(f"build.py: awnings file not found: {awnings}")
    out_dir.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(exist_ok=True)

    if args.fixtures:
        print("== PLACEHOLDER inputs: graph.json, buildings.geojson, trees.geojson copied from contracts/fixtures/")
        for name in ("graph.json", "buildings.geojson", "trees.geojson"):
            shutil.copyfile(FIXTURES / name, out_dir / name)
    else:
        steps = [("graph", "build_graph.py", "graph.json"), ("buildings", "buildings.py", "buildings.geojson"),
                 ("trees", "trees.py", "trees.geojson")]
        scripts = [(label, step_script(name, label), out) for label, name, out in steps]   # fail before any download
        for label, script, out in scripts:
            run(label, script, "--out", out_dir / out)

    shadows_dir = out_dir / "shadows"
    if shadows_dir.is_dir():
        for f in shadows_dir.glob("*.geojson"):
            f.unlink()                    # no stale slot files (validate rejects unexpected ones)
    run("shadows", HERE / "shadows.py", "--dir", out_dir, "--out", RAW_SHADE, "--shadows-dir", shadows_dir)

    print("\n== shade: merging awnings")
    print("  " + merge_awnings(RAW_SHADE, awnings, out_dir / "shade.json"))
    if awnings is not None:
        shutil.copyfile(awnings, out_dir / "awnings.json")   # so validate.py cross-checks it against this graph

    print_sizes(out_dir)
    print("\n== validate")
    r = subprocess.run([sys.executable, HERE / "validate.py", str(out_dir)], cwd=HERE)
    print("\nbuild.py: " + ("OK" if r.returncode == 0 else "validate.py FAILED"))
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
