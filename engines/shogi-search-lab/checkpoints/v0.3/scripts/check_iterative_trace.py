#!/usr/bin/env python3
"""Verify previous-PV hints are used only on the same path in the next tree."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results/v0.2"
EXE = ROOT / "build/shogi-lab"
OUT.mkdir(exist_ok=True)
path = OUT / "iterative-trace.jsonl"
subprocess.run([str(EXE), "--sfen", "4k4/9/P8/9/9/9/9/9/4K4 b - 1", "--depth", "4", "--iterative", "--trace", str(path)], check=True, stdout=subprocess.DEVNULL)
events = [json.loads(line) for line in path.read_text().splitlines()]
assert events[-1]["complete"] and events[-1]["omitted_events"] == 0
entries = {e["id"]: e for e in events if e["event"] == "enter"}
previous = []
priorities = []
for e in events:
    if e["event"] == "iteration_complete":
        previous = e["pv"]
    elif e["event"] == "pv_priority":
        node = entries[e["id"]]
        path_moves = []
        while node["parent"]:
            path_moves.append(node["move"])
            node = entries[node["parent"]]
        path_moves.reverse()
        assert path_moves == previous[:len(path_moves)]
        assert e["move"] == previous[len(path_moves)]
        children = [x for x in entries.values() if x["parent"] == e["id"]]
        assert min(children, key=lambda x: x["id"])["move"] == e["move"]
        priorities.append({"id": e["id"], "path": path_moves, "move": e["move"]})
assert len(priorities) == 6 # 1 + 2 + 3 prior-PV nodes over depths 2, 3, 4.
report = {"status": "passed", "nodes": len(entries), "verified_pv_priorities": priorities}
(OUT / "trace-validation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"status": "passed", "nodes": len(entries), "priority_checks": len(priorities)}))
