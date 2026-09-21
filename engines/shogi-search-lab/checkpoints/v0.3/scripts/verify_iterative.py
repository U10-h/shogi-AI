#!/usr/bin/env python3
"""Exhaustive-reference comparison, PV replay, and interrupted-iteration checks."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "build/shogi-lab"
RESULTS = ROOT / "results/v0.2"


def run(case, depth, flags=(), moves=None, algorithm="ordered"):
    args = [str(EXE), "--sfen", case["initial"], "--moves", " ".join(case["moves"] if moves is None else moves),
            "--depth", str(depth), "--algorithm", algorithm, "--max-nodes", "20000000", *flags]
    p = subprocess.run(args, text=True, capture_output=True, timeout=60)
    if p.returncode not in (0, 3):
        raise RuntimeError(p.stderr)
    return json.loads(p.stdout)


def root_score(score, ply):
    value = score if ply % 2 == 0 else -score
    if abs(value) > 90000:
        value += -ply if value > 0 else ply
    return value


def verify_pv(case, result, exhaustive=False):
    assert result["has_result"]
    moves = case["moves"] + result["pv"]
    # CLI replays every move through the legal generator and preserves history.
    end = run(case, 0, moves=moves, algorithm="minimax")
    assert end["has_result"] and root_score(end["score"], len(result["pv"])) == result["score"]
    if len(result["pv"]) < result["completed_depth"]:
        assert end["terminals"] == 1
    else:
        assert len(result["pv"]) == result["completed_depth"]
    if exhaustive:
        for ply in range(1, len(result["pv"]) + 1):
            child = run(case, result["completed_depth"] - ply, moves=case["moves"] + result["pv"][:ply], algorithm="minimax")
            assert child["complete"] and root_score(child["score"], ply) == result["score"]


def main():
    RESULTS.mkdir(exist_ok=True)
    cases = json.loads((ROOT / "experiments/positions.json").read_text())["positions"]
    rows = []
    completed_iterations = 0
    for case in cases:
        references = {depth: run(case, depth, algorithm="minimax") for depth in (1, 2, 3)}
        assert all(r["complete"] for r in references.values())
        for flags in (("--iterative", "--no-pv-order"), ("--iterative",)):
            result = run(case, 3, flags)
            assert result["complete"] and result["completed_depth"] == 3
            for step in result["iterations"]:
                assert step["score"] == references[step["depth"]]["score"]
                view = {**step, "has_result": True, "completed_depth": step["depth"]}
                verify_pv(case, view, exhaustive=True)
                completed_iterations += 1
            rows.append({"case": case["id"], "pv_order": result["pv_order"], "depth": 3, "score": result["score"], "nodes": result["nodes"]})
        print("verified", case["id"], flush=True)
    # A deeper exhaustive comparison where the complete tree remains tractable.
    case = cases[0]
    reference = run(case, 4, algorithm="minimax")
    result = run(case, 4, ("--iterative",))
    assert reference["complete"] and result["complete"] and reference["score"] == result["score"]
    verify_pv(case, result, exhaustive=True)
    rows.append({"case": case["id"], "depth": 4, "exhaustive_nodes": reference["nodes"], "iterative_nodes": result["nodes"], "score": result["score"]})
    # Check exact publication at a node limit and during the following iteration.
    first = run(case, 1)
    interruptions = []
    for budget in (1, first["nodes"], first["nodes"] + 5):
        limited = run(case, 8, ("--iterative", "--max-nodes", str(budget)))
        assert not limited["complete"] and limited["stop_reason"] == "node_limit"
        if budget < first["nodes"]:
            assert not limited["has_result"] and limited["score"] is None and not limited["pv"]
        else:
            assert limited["completed_depth"] == 1 and limited["score"] == first["score"] and limited["pv"] == first["pv"]
            verify_pv(case, limited)
        interruptions.append(limited)
    # A known losing capture changes when the opponent's recapture is included.
    trap = {"initial": "8k/9/4g4/4p4/4R4/9/9/9/K8 b - 1", "moves": []}
    tactical = run(trap, 2, ("--iterative",))
    assert tactical["iterations"][0]["pv"][0] == "5e5d"
    assert tactical["iterations"][1]["pv"][0] != "5e5d"
    punished = run(trap, 1, moves=["5e5d"], algorithm="minimax")
    assert punished["pv"][0] == "5c5d" and punished["score"] == 1450
    verify_pv(trap, tactical, exhaustive=True)
    report = {"status": "passed", "full_reference_iterations_depth_1_to_3": completed_iterations,
              "deeper_exhaustive_reference": rows[-1], "checks": rows, "interruptions": interruptions,
              "recapture_example": {"case": trap, "result": tactical, "punished_capture": punished}}
    (RESULTS / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": "passed", "verified_iterations": completed_iterations, "deeper_reference_nodes": reference["nodes"]}))


if __name__ == "__main__":
    main()
