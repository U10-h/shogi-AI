#!/usr/bin/env python3
"""Same-depth and same-time comparisons, including all iterative overhead."""
import csv
import hashlib
import json
import platform
import statistics
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from verify_iterative import run, verify_pv

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results/v0.2"
MODES = {"fixed": (), "id_plain": ("--iterative", "--no-pv-order"), "id_pv": ("--iterative",)}


def main():
    OUT.mkdir(exist_ok=True)
    cases = json.loads((ROOT / "experiments/positions.json").read_text())["positions"]
    raw = []
    summaries = []
    for case in cases:
        modes = list(MODES)
        for mode in modes:
            run(case, 4, MODES[mode])
        collected = {mode: [] for mode in modes}
        for repeat in range(3):
            for mode in modes[repeat:] + modes[:repeat]:
                result = run(case, 4, MODES[mode])
                assert result["complete"]
                collected[mode].append(result)
                raw.append({"experiment": "depth_4", "position": case["id"], "mode": mode, "repeat": repeat + 1, **result})
        assert len({r["score"] for samples in collected.values() for r in samples}) == 1
        for mode, samples in collected.items():
            assert len({r["nodes"] for r in samples}) == 1
            verify_pv(case, samples[0])
            summaries.append({"position": case["id"], "mode": mode, "nodes": samples[0]["nodes"],
                              "last_iteration_nodes": samples[0]["iterations"][-1]["nodes"],
                              "score": samples[0]["score"], "median_ms": statistics.median(r["elapsed_ms"] for r in samples),
                              "min_ms": min(r["elapsed_ms"] for r in samples), "max_ms": max(r["elapsed_ms"] for r in samples)})
        print("depth4", case["id"], {mode: samples[0]["nodes"] for mode, samples in collected.items()}, flush=True)
    with (OUT / "depth4.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=summaries[0].keys()); w.writeheader(); w.writerows(summaries)
    # Compare the two usable anytime methods, with identical 200-ms budgets.
    timed = []
    cache = {}
    for case in cases:
        modes = ["id_plain", "id_pv"]
        for mode in modes:
            run(case, 8, (*MODES[mode], "--time-ms", "200"))
        for repeat in range(3):
            for mode in modes[repeat % 2:] + modes[:repeat % 2]:
                result = run(case, 8, (*MODES[mode], "--time-ms", "200"))
                assert result["has_result"]
                verify_pv(case, result)
                key = (case["id"], result["completed_depth"])
                if key not in cache:
                    reference = run(case, result["completed_depth"])
                    assert reference["complete"]
                    cache[key] = reference["score"]
                assert result["score"] == cache[key]
                row = {"experiment": "time_200ms", "position": case["id"], "mode": mode, "repeat": repeat + 1, **result}
                raw.append(row); timed.append(row)
        print("timed", case["id"], [(r["mode"], r["completed_depth"]) for r in timed[-6:]], flush=True)
    (OUT / "raw.json").write_text(json.dumps(raw, indent=2) + "\n")
    (OUT / "timed.json").write_text(json.dumps(timed, indent=2) + "\n")
    metadata = {"utc": datetime.now(timezone.utc).isoformat(), "platform": platform.platform(),
                "compiler": subprocess.check_output(["g++", "--version"], text=True).splitlines()[0],
                "source_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / "src").glob("*"))},
                "suite_sha256": hashlib.sha256((ROOT / "experiments/positions.json").read_bytes()).hexdigest(),
                "depth": 4, "time_budget_ms": 200, "repeats": 3, "warmups_per_case_mode": 1,
                "node_budget": 20000000, "trace": False, "sequential_execution": True,
                "timing": "Search only, includes all completed and aborted iterations and PV ordering. Soft deadline checked at every visited node.",
                "deeper_timed_reference": "Fixed-depth alpha-beta with capture/promotion ordering; exhaustive verification is reported separately."}
    (OUT / "environment.json").write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    main()
