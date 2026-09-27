#!/usr/bin/env python3
"""Summarize the two-position shared-runtime correctness gate."""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0b')
out = p.parse_args().out
manifest = json.loads((out/'manifest.json').read_text())
summary = {'condition_sha256': manifest['condition_sha256'], 'positions': 2,
           'comparison_searches': 0, 'control_searches': 0, 'static_unique_positions': 0,
           'static_equal_comparisons_to_reference': 0, 'full_depth_eval_checks': 0,
           'full_depth_eval_mismatches': 0, 'all_saved_checks_passed': True, 'rows': []}
for pos in manifest['positions']:
    data = {}
    for stage in ['static', 'search', 'interrupt']:
        r = json.loads((out/f'{stage}/{pos["id"]}.json').read_text())
        assert r['condition_sha256'] == manifest['condition_sha256'] and r['passed']
        data[stage] = r
    s = data['static']
    summary['static_unique_positions'] += len(s['histories'])
    for mode in ['standard', 'minimax', 'alphabeta']:
        assert s['scores'][mode] == s['scores']['reference']
        summary['static_equal_comparisons_to_reference'] += len(s['histories'])
    engines = data['search']['engines']
    summary['comparison_searches'] += len(engines)
    summary['control_searches'] += len(data['interrupt']['searches'])
    for mode in ['minimax', 'alphabeta']:
        row = engines[mode]
        assert row['root_restored'] and row['completed_depth'] == 3
        summary['full_depth_eval_checks'] += row['eval_checks']
        summary['full_depth_eval_mismatches'] += row['eval_mismatches']
        summary['rows'].append({'position': pos['id'], 'mode': mode, 'depth': row['completed_depth'],
                              'bestmove': row['bestmove'], 'score_raw': row['score_raw'],
                              'nodes': row['nodes'], 'cutoffs': row['cutoffs'],
                              'eval_checks': row['eval_checks'], 'search_ms_with_audit': row['search_ms']})
    for name, value in data['interrupt']['checks'].items():
        assert value, name
(out/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
with (out/'searches.csv').open('w') as f:
    writer = csv.DictWriter(f, fieldnames=list(summary['rows'][0]), lineterminator='\n')
    writer.writeheader(); writer.writerows(summary['rows'])
print(json.dumps(summary, indent=2))
