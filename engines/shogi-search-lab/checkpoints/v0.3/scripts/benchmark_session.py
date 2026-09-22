#!/usr/bin/env python3
"""Top-five continuation: compare warm and fresh sessions at identical history."""
import csv
import hashlib
import json
import platform
import statistics
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from verify_iterative import run, root_score

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "build/shogi-lab"
OUT = ROOT / "results/v0.3"


class Session:
    def __init__(self, case, extra_moves=()):
        self.process = subprocess.Popen([str(EXE), "--session", "--sfen", case["initial"], "--moves", " ".join(case["moves"] + list(extra_moves))],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        self.ready = self.read()

    def read(self):
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(self.process.stderr.read())
        data = json.loads(line)
        if data.get("event") == "error":
            raise RuntimeError(data["error"])
        return data

    def command(self, text):
        self.process.stdin.write(text + "\n"); self.process.stdin.flush()
        return self.read()

    def close(self):
        self.command("quit")
        self.process.wait(timeout=10)
        self.process.stdin.close(); self.process.stdout.close(); self.process.stderr.close()


def pairs(position):
    return [(c["move"], c["score"]) for c in position["candidates"]]


def verify_lines(case, position):
    assert position["candidates_complete"]
    for c in position["candidates"]:
        leaf = run(case, 0, moves=case["moves"] + c["pv"], algorithm="minimax")
        assert leaf["complete"] and root_score(leaf["score"], len(c["pv"])) == c["score"]
        assert len(c["pv"]) == c["depth"] or leaf["terminals"] == 1


def main():
    OUT.mkdir(exist_ok=True)
    suite = json.loads((ROOT / "experiments/positions.json").read_text())["positions"]
    # Fixed before timing; all five ranks are covered by the C++ tests.
    cases = [p for p in suite if p["id"] in ("initial", "bishop-exchange", "gokigen-20")]
    rows = []
    examples = []
    for case in cases:
        for rank in (1, 3, 5):
            for repeat in range(3):
                warm = Session(case)
                before = warm.command("go depth 3 time 0")
                assert before["complete"]
                candidate = before["position"]["candidates"][rank - 1]
                advanced = warm.command("advance " + candidate["move"])
                assert advanced["reused_tree"] and advanced["previous_rank"] == rank
                assert advanced["position"]["root_id"] == candidate["node_id"]
                assert advanced["position"]["completed_depth"] == 2
                assert advanced["position"]["pv"] == candidate["pv"][1:]
                cold = Session(case, [candidate["move"]])
                # Alternate measurement order; both searches are sequential.
                if repeat % 2:
                    fresh = cold.command("go depth 3 time 0")
                    kept = warm.command("go depth 3 time 0")
                else:
                    kept = warm.command("go depth 3 time 0")
                    fresh = cold.command("go depth 3 time 0")
                assert kept["complete"] and fresh["complete"]
                assert pairs(kept["position"]) == pairs(fresh["position"])
                assert kept["position"]["score"] == fresh["position"]["score"]
                assert kept["exact_hits"] + kept["bound_hits"] > 0
                child_case = {**case, "moves": case["moves"] + [candidate["move"]]}
                verify_lines(child_case, kept["position"])
                verify_lines(child_case, fresh["position"])
                rows.append({"position": case["id"], "rank": rank, "repeat": repeat + 1, "move": candidate["move"],
                             "parent_nodes": before["nodes"], "warm_nodes": kept["nodes"], "cold_nodes": fresh["nodes"],
                             "warm_ms": kept["elapsed_ms"], "cold_ms": fresh["elapsed_ms"],
                             "exact_hits": kept["exact_hits"], "bound_hits": kept["bound_hits"],
                             "tree_nodes": kept["position"]["tree_nodes"], "capacity_misses": kept["capacity_misses"]})
                if repeat == 0:
                    examples.append({"case": case["id"], "rank": rank, "before": before, "advanced": advanced, "continued": kept, "fresh": fresh})
                warm.close(); cold.close()
            print(case["id"], "rank", rank, "verified", flush=True)
    # Exercise the user-facing automatic play -> continuation command too.
    auto = Session(cases[0])
    before = auto.command("go depth 3 time 0")
    move = before["position"]["candidates"][4]["move"]
    automatic = auto.command("play " + move)
    assert automatic["event"] == "played_and_searched"
    assert automatic["advance"]["previous_rank"] == 5 and automatic["advance"]["reused_tree"]
    assert automatic["analysis"]["position"]["has_result"]
    if automatic["analysis"]["position"]["candidates_complete"]:
        verify_lines({**cases[0], "moves": cases[0]["moves"] + [move]}, automatic["analysis"]["position"])
    auto.close()
    summaries = []
    for case in cases:
        for rank in (1, 3, 5):
            samples = [r for r in rows if r["position"] == case["id"] and r["rank"] == rank]
            assert len({(r["warm_nodes"], r["cold_nodes"]) for r in samples}) == 1
            summaries.append({"position": case["id"], "rank": rank, "move": samples[0]["move"],
                              "warm_nodes": samples[0]["warm_nodes"], "cold_nodes": samples[0]["cold_nodes"],
                              "warm_median_ms": statistics.median(r["warm_ms"] for r in samples),
                              "cold_median_ms": statistics.median(r["cold_ms"] for r in samples),
                              "warm_min_ms": min(r["warm_ms"] for r in samples), "warm_max_ms": max(r["warm_ms"] for r in samples),
                              "cold_min_ms": min(r["cold_ms"] for r in samples), "cold_max_ms": max(r["cold_ms"] for r in samples)})
    with (OUT / "continuation.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=summaries[0]); writer.writeheader(); writer.writerows(summaries)
    (OUT / "raw.json").write_text(json.dumps(rows, indent=2) + "\n")
    (OUT / "examples.json").write_text(json.dumps(examples, indent=2) + "\n")
    (OUT / "automatic-play.json").write_text(json.dumps({"before": before, "played": automatic}, indent=2) + "\n")
    (OUT / "environment.json").write_text(json.dumps({"utc": datetime.now(timezone.utc).isoformat(), "platform": platform.platform(),
        "compiler": subprocess.check_output(["g++", "--version"], text=True).splitlines()[0],
        "source_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / "src").glob("*"))},
        "suite_sha256": hashlib.sha256((ROOT / "experiments/positions.json").read_bytes()).hexdigest(),
        "conditions": "Three specified positions, ranks 1/3/5, three repeats, sequential alternating order. Parent depth 3, then child depth 3; both return exact top five.",
        "timing": "Continuation search only; prior parent analysis excluded and recorded separately. First samples retained, no warm-up runs.",
        "tree_capacity": 50000, "all_top_five_values_match_fresh": True, "all_pvs_legally_replay_and_match_leaf_score": True}, indent=2) + "\n")


if __name__ == "__main__":
    main()
