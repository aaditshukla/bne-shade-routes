#!/usr/bin/env python3
"""D8 check: build.merge_awnings() does what contracts/data-formats.md says. Standard library only.

    python check_awnings_merge.py            # synthetic cases (no data files needed)
    python check_awnings_merge.py RAW AWN OUT  # also compare a real run: RAW = cache/shade_raw.json,
                                               #   AWN = awnings.json used, OUT = the shade.json build.py wrote

Rules checked: only `verified: true` merges; sunFraction *= (1 - covered_fraction) for every slot;
slots with alt <= 0 stay 0; other edges untouched; values stay in [0, 1] with 2 decimals;
an awning key that is not a graph edge stops the build.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import merge_awnings  # noqa: E402

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)
        print("FAIL", msg)


def expect(raw_sf, awnings, out_sf, label):
    """Independent re-computation of the contract rule against a merged result."""
    for eid, row in raw_sf.items():
        a = awnings.get("edges", {}).get(eid)
        keep = 1 - a["covered_fraction"] if a and a.get("verified") is True else 1.0
        want = [round(x * keep, 2) for x in row]
        check(out_sf[eid] == want, f"{label}: {eid} expected {want[:3]}.. got {out_sf[eid][:3]}..")
        check(all(0 <= x <= 1 and round(x, 2) == x for x in out_sf[eid]), f"{label}: {eid} out of range / not 2dp")
        check(all(o <= v for v, o in zip(row, out_sf[eid])), f"{label}: {eid} got sunnier")


def synthetic():
    raw = {"version": 1, "sunFraction": {
        "e_a": [0.0, 1.0, 0.5, 0.33, 0.0], "e_b": [0.0, 0.9, 0.9, 0.2, 0.0], "e_c": [0.0, 1.0, 1.0, 1.0, 0.0],
        "e_d": [0.0, 0.7, 0.7, 0.7, 0.0], "e_e": [0.0, 1.0, 1.0, 1.0, 0.0]}}
    aw = {"version": 1, "edges": {
        "e_a": {"kind": "awning", "covered_fraction": 0.8, "verified": True},        # merged
        "e_b": {"kind": "verandah", "covered_fraction": 1.0, "verified": True},      # fully covered -> 0
        "e_c": {"kind": "awning", "covered_fraction": 0.9, "verified": False},       # ignored
        "e_d": {"kind": "awning", "covered_fraction": 0.5, "verified": "true"},      # not boolean true: ignored
        "e_e": {"kind": "awning", "covered_fraction": 0.0, "verified": True}}}       # no-op
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "raw.json").write_text(json.dumps(raw))
        (d / "aw.json").write_text(json.dumps(aw))
        summary = merge_awnings(d / "raw.json", d / "aw.json", d / "out.json")
        out = json.loads((d / "out.json").read_text())["sunFraction"]
        expect(raw["sunFraction"], aw, out, "synthetic")
        check(out["e_a"] == [0.0, 0.2, 0.1, 0.07, 0.0], f"e_a values {out['e_a']}")
        check(out["e_b"] == [0.0] * 5, "fully covered edge is not 0 everywhere")
        check(out["e_c"] == raw["sunFraction"]["e_c"], "unverified entry changed shade")
        check(out["e_d"] == raw["sunFraction"]["e_d"], 'verified:"true" (string) was merged')
        check("3 verified merged" in summary and "2 unverified ignored" in summary, f"summary: {summary}")
        merge_awnings(d / "raw.json", None, d / "out2.json")
        check(json.loads((d / "out2.json").read_text())["sunFraction"] == raw["sunFraction"], "no awnings file changed shade")
        aw["edges"]["e_nope"] = {"kind": "awning", "covered_fraction": 0.5, "verified": True}
        (d / "aw.json").write_text(json.dumps(aw))
        try:
            merge_awnings(d / "raw.json", d / "aw.json", d / "out3.json")
            check(False, "unknown verified edge id did not stop the build")
        except SystemExit:
            pass


def real(raw_p, aw_p, out_p):
    raw = json.loads(Path(raw_p).read_text())
    aw = json.loads(Path(aw_p).read_text())
    out = json.loads(Path(out_p).read_text())
    check(set(out["sunFraction"]) == set(raw["sunFraction"]), "edge set differs from raw shade")
    check(out["sun"] == raw["sun"] and out["slots"] == raw["slots"], "sun/slots changed")
    expect(raw["sunFraction"], aw, out["sunFraction"], "real")
    night = [i for i, s in enumerate(out["sun"]) if s["alt_deg"] <= 0]
    check(all(out["sunFraction"][e][i] == 0 for e in out["sunFraction"] for i in night), "night slot not 0")
    n = sum(1 for e, a in aw["edges"].items() if a.get("verified") is True)
    print(f"real: {n} verified edges checked against {len(raw['sunFraction'])} edges x {len(out['slots'])} slots")


if __name__ == "__main__":
    synthetic()
    if len(sys.argv) == 4:
        real(*sys.argv[1:])
    print("FAILED: %d" % len(fails) if fails else "OK: awnings merge matches contracts/data-formats.md")
    sys.exit(1 if fails else 0)
