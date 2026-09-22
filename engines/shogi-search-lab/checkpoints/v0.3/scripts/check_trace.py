#!/usr/bin/env python3
"""Validate the supplied complete, repetition-free teaching trace."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "build/shogi-lab"
TRACE = ROOT / "results/promotion-trace.jsonl"
SFEN = "4k4/9/P8/9/9/9/9/9/4K4 b - 1"


def main():
    run = subprocess.run([str(EXE), "--sfen", SFEN, "--algorithm", "ordered", "--depth", "3", "--trace", str(TRACE)], check=True, text=True, capture_output=True)
    events = [json.loads(line) for line in TRACE.read_text().splitlines()]
    entries = {e["id"]: e for e in events if e["event"] == "enter"}
    returns = {e["id"]: e for e in events if e["event"] == "return"}
    cutoffs = [e for e in events if e["event"] == "cutoff"]
    assert entries.keys() == returns.keys()
    assert events[-1]["omitted_events"] == 0 and events[-1]["complete"]
    assert len(entries) == json.loads(run.stdout)["nodes"]
    for node_id, entry in entries.items():
        if entry["parent"]:
            assert entries[entry["parent"]]["ply"] + 1 == entry["ply"]
        reference = json.loads(subprocess.check_output([str(EXE), "--sfen", entry["sfen"], "--algorithm", "minimax", "--depth", str(entry["depth"])], text=True))
        truth = reference["score"]
        actual = returns[node_id]
        assert (actual["bound"] == "exact" and actual["score"] == truth
                or actual["bound"] == "lower" and actual["score"] <= truth
                or actual["bound"] == "upper" and actual["score"] >= truth)
    for event in cutoffs:
        assert event["alpha"] >= event["beta"]
        visited = {x["move"] for x in entries.values() if x["parent"] == event["id"]}
        assert not visited.intersection(event["skipped_moves"])
    # Truncation is explicit and node exhaustion exposes no completed score/PV.
    truncated = ROOT / "build/truncated-trace.jsonl"
    p = subprocess.run([str(EXE), "--depth", "3", "--max-nodes", "7", "--trace", str(truncated), "--trace-limit", "1"], text=True, capture_output=True)
    assert p.returncode == 3
    aborted = json.loads(p.stdout)
    assert not aborted["complete"] and aborted["score"] is None and aborted["pv"] == []
    last = json.loads(truncated.read_text().splitlines()[-1])
    assert last["omitted_events"] > 0 and not last["complete"]
    summary = {"status": "passed", "nodes_with_verified_bounds": len(entries), "verified_cutoffs": len(cutoffs), "budget_abort_and_trace_truncation": "passed"}
    (ROOT / "results/trace-validation.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
