#!/usr/bin/env python3
"""Frozen factorial experiment. Run alone, after building/testing, without CPU jobs."""
import json
import platform
import statistics
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / 'build/shogi-lab'
OUT = ROOT / 'results/v0.4'
POLICIES = ['full', 'screen', 'full-probe', 'probe']
CASES = json.loads((ROOT / 'experiments/v0.4-protocol.json').read_text())['positions']

def analyze(case, policy, commands=None, trace=None, recursive=False):
    args = [str(BIN), '--session', '--sfen', case['initial'], '--moves', ' '.join(case['moves']),
            '--root-policy', policy, '--max-nodes', '5000000']
    if trace:
        args += ['--trace', str(trace), '--trace-limit', '2000000']
        if not recursive: args += ['--trace-root-only']
    commands = commands or f"go depth {case['depth']}\nquit\n"
    run = subprocess.run(args, input=commands, text=True, capture_output=True, check=True)
    events = [json.loads(line) for line in run.stdout.splitlines()]
    assert not any(e['event'] == 'error' for e in events), events
    return events

def signature(result):
    p = result['position']
    return [(c['move'], c['score']) for c in p['candidates']]

def main():
    OUT.mkdir(exist_ok=True)
    rows = []
    expected = {}
    # Untimed warmup per variant, in separate process; no tree carried forward.
    for policy in POLICIES: analyze(CASES[0], policy)
    for ci, case in enumerate(CASES):
        for repetition in range(3):
            rotation = (ci + repetition) % 4
            for policy in POLICIES[rotation:] + POLICIES[:rotation]:
                result = analyze(case, policy)[1]
                assert result['complete'] and result['position']['candidates_complete'], result
                sig = signature(result)
                if case['id'] not in expected: expected[case['id']] = sig
                assert sig == expected[case['id']], (case['id'], policy, sig, expected[case['id']])
                rows.append(dict(case=case['id'], group=case['group'], depth=case['depth'], policy=policy,
                                 repetition=repetition, **result))
        print(json.dumps({'completed_case':case['id']}), flush=True)
    (OUT / 'timings.json').write_text(json.dumps(rows, indent=2) + '\n')
    cases = []
    for case in CASES:
        med = {}
        for policy in POLICIES:
            subset = [r for r in rows if r['case'] == case['id'] and r['policy'] == policy]
            med[policy] = {k:statistics.median(r[k] for r in subset) for k in
                ['elapsed_ms','nodes','probe_nodes','probe_ms','root_exclusions','root_researches','root_full_searches']}
        cases.append(dict(id=case['id'], group=case['group'], depth=case['depth'], variants=med))
    aggregate = {}
    for policy in POLICIES:
        aggregate[policy] = {k:sum(c['variants'][policy][k] for c in cases) for k in cases[0]['variants'][policy]}
        aggregate[policy]['faster_than_full_cases'] = sum(c['variants'][policy]['elapsed_ms'] < c['variants']['full']['elapsed_ms'] for c in cases)
    summary = dict(cases=len(cases), repetitions=3, runs=len(rows), all_top5_equal=True,
                   platform=platform.platform(), compiler=subprocess.check_output(['g++','--version'],text=True).splitlines()[0],
                   aggregate=aggregate, per_case=cases)
    (OUT / 'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='per_case'}, indent=2))

if __name__ == '__main__': main()
