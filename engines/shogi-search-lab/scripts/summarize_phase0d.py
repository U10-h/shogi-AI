#!/usr/bin/env python3
"""Summarize the two-position ordering gate, including unchanged-tree checks."""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0d')
out = p.parse_args().out
manifest = json.loads((out/'manifest.json').read_text())
summary = {'condition_sha256': manifest['condition_sha256'], 'positions': len(manifest['positions']),
           'comparison_searches': 0, 'control_searches': 0, 'tie_searches': 0,
           'new_pilot_comparison_eval_checks': 0, 'eval_mismatches': 0,
           'passed': True, 'rows': [], 'comparisons': [], 'controls': []}
fields = ['bestmove', 'score_raw', 'nodes', 'completed_depth', 'seldepth', 'qnodes',
          'eval_checks', 'eval_mismatches', 'main_order_changes', 'q_order_changes',
          'cutoffs', 'main_first_cutoffs', 'qchild_cutoffs', 'q_first_cutoffs',
          'main_skipped_siblings', 'q_skipped_siblings', 'search_ms']
for pos in manifest['positions']:
    pair = json.loads((out/f'compare/{pos["id"]}.json').read_text())
    control = json.loads((out/f'control/{pos["id"]}.json').read_text())
    for r in [pair, control]:
        assert r['passed'] and r['condition_sha256'] == manifest['condition_sha256']
    engines = pair['engines']
    summary['comparison_searches'] += len(engines)
    summary['control_searches'] += len(control['searches'])
    summary['tie_searches'] += len(pair['tie_checks'])
    for name in ['lexical_minimax', 'tactical_minimax', 'lexical_alpha', 'tactical_alpha']:
        row = engines[name]
        assert row['root_restored'] and row['completed_depth'] == 2 and row['eval_mismatches'] == 0
        summary['rows'].append({'position': pos['id'], 'mode': name, **{k: row[k] for k in fields}})
        summary['new_pilot_comparison_eval_checks'] += row['eval_checks']
        summary['eval_mismatches'] += row['eval_mismatches']
    a, b = engines['lexical_alpha'], engines['tactical_alpha']
    summary['comparisons'].append({'position': pos['id'],
        'lexical_nodes': a['nodes'], 'tactical_nodes': b['nodes'],
        'node_reduction': 1-b['nodes']/a['nodes'],
        'same_score': a['score_raw'] == b['score_raw'],
        'same_bestmove': a['bestmove'] == b['bestmove'], 'same_pv': a['pv'] == b['pv'],
        'full_width_same_nodes': engines['lexical_minimax']['nodes'] == engines['tactical_minimax']['nodes'],
        'full_width_same_score': engines['lexical_minimax']['score_raw'] == engines['tactical_minimax']['score_raw']})
    for name, row in control['searches'].items():
        assert row['root_restored'] and row['legal_pv_verified'] and row['eval_mismatches'] == 0
        summary['controls'].append({'position': pos['id'], 'case': name,
            **{k: row[k] for k in ['nodes', 'completed_depth', 'stop_reason', 'root_restored', 'eval_mismatches']}})
(out/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
with (out/'searches.csv').open('w') as f:
    writer = csv.DictWriter(f, fieldnames=list(summary['rows'][0]), lineterminator='\n')
    writer.writeheader(); writer.writerows(summary['rows'])
print(json.dumps({k:v for k,v in summary.items() if k not in ['rows','controls']}, indent=2))
