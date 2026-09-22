#!/usr/bin/env python3
"""Fixed-depth correctness and timing comparison; no concurrent engine workers."""
import csv
import hashlib
import json
import platform
import statistics
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "build/shogi-lab"
ALGORITHMS = ["minimax", "alphabeta", "ordered"]


def run(position, algorithm, depth=None, moves=None):
    command = [str(EXE), "--algorithm", algorithm, "--depth", str(depth if depth is not None else position["depth"]),
               "--max-nodes", "2000000", "--sfen", position["initial"], "--moves", " ".join(moves if moves is not None else position["moves"])]
    result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=True)
    data = json.loads(result.stdout)
    if not data["complete"]:
        raise RuntimeError("Incomplete search cannot be used as a benchmark result")
    return data


def main():
    suite = json.loads((ROOT / "experiments/positions.json").read_text())
    rows = []
    raw = []
    for position in suite["positions"]:
        # One unmeasured warm-up per method, then three rotations of method order.
        for algorithm in ALGORITHMS:
            run(position, algorithm)
        samples = {a: [] for a in ALGORITHMS}
        for repeat in range(3):
            for algorithm in ALGORITHMS[repeat:] + ALGORITHMS[:repeat]:
                data = run(position, algorithm)
                raw.append({"position": position["id"], "repeat": repeat + 1, **data})
                samples[algorithm].append(data)
        scores = {x["score"] for items in samples.values() for x in items}
        if len(scores) != 1:
            raise AssertionError(f"Evaluation mismatch: {position['id']}")
        for algorithm, items in samples.items():
            if len({(x["nodes"], x["bestmove"], tuple(x["pv"])) for x in items}) != 1:
                raise AssertionError("Non-deterministic search")
            best = items[0]["bestmove"]
            # Independently evaluate the chosen root child with full minimax.
            if best is not None:
                child = run(position, "minimax", depth=position["depth"] - 1, moves=position["moves"] + [best])
                child_value = -child["score"]
                # Child search resets ply to zero. Align mate distance to root.
                if abs(child_value) > 90000:
                    child_value += -1 if child_value > 0 else 1
                if child_value != items[0]["score"]:
                    raise AssertionError("Chosen move does not achieve root value")
            row = {"position": position["id"], "depth": position["depth"], "algorithm": algorithm,
                   "score": items[0]["score"], "bestmove": best, "nodes": items[0]["nodes"],
                   "median_ms": round(statistics.median(x["elapsed_ms"] for x in items), 3),
                   "min_ms": min(x["elapsed_ms"] for x in items), "max_ms": max(x["elapsed_ms"] for x in items),
                   "cutoffs": items[0]["cutoffs"], "skipped_siblings": items[0]["skipped_siblings"]}
            rows.append(row)
        print(position["id"], [(a, samples[a][0]["nodes"]) for a in ALGORITHMS], flush=True)
    results = ROOT / "results"
    results.mkdir(exist_ok=True)
    (results / "raw.json").write_text(json.dumps(raw, indent=2) + "\n")
    with (results / "benchmark.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    metadata = {"utc": datetime.now(timezone.utc).isoformat(), "platform": platform.platform(),
                "compiler": subprocess.check_output(["g++", "--version"], text=True).splitlines()[0],
                "executable_sha256": hashlib.sha256(EXE.read_bytes()).hexdigest(),
                "suite_sha256": hashlib.sha256((ROOT / "experiments/positions.json").read_bytes()).hexdigest(),
                "source_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / "src").glob("*"))},
                "repeats": 3, "warmups": 1, "trace_enabled": False,
                "timing": "C++ steady_clock search time; excludes process/board initialization, includes legal generation and material evaluation; sequential processes",
                "all_scores_match": True, "all_chosen_moves_optimal_at_tested_depth": True}
    (results / "environment.json").write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    main()
