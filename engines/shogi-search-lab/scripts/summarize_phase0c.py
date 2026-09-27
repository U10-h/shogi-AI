#!/usr/bin/env python3
"""Summarize the fixed two-position bounded-qsearch integration experiment."""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0c')
out = p.parse_args().out
manifest = json.loads((out/'manifest.json').read_text())
summary = {'condition_sha256': manifest['condition_sha256'], 'positions': 2,
           'comparison_searches': 0, 'control_searches': 0, 'q_eval_checks': 0,
           'q_eval_mismatches': 0, 'q_check_nodes_beyond_nominal_budget': 0,
           'plain_agreement_with_standard': 0, 'q_agreement_with_standard': 0,
           'q_vs_plain_bestmove_changes': 0, 'passed': True, 'rows': []}
for pos in manifest['positions']:
    pair = json.loads((out/f'compare/{pos["id"]}.json').read_text())
    control = json.loads((out/f'control/{pos["id"]}.json').read_text())
    for r in [pair, control]:
        assert r['passed'] and r['condition_sha256'] == manifest['condition_sha256']
    engines = pair['engines']
    summary['comparison_searches'] += len(engines)
    summary['control_searches'] += len(control['searches'])
    summary['q_vs_plain_bestmove_changes'] += int(pair['q_vs_plain_bestmove_changed'])
    for prefix, name in [('plain', 'plain'), ('q', 'q_alphabeta')]:
        summary[prefix+'_agreement_with_standard'] += int(engines[name]['bestmove'] == engines['standard']['bestmove'])
    for name in ['plain', 'q_minimax', 'q_alphabeta']:
        row = engines[name]
        assert row['root_restored'] and row['completed_depth'] == 2 and row['eval_mismatches'] == 0
        summary['rows'].append({'position': pos['id'], 'mode': name,
            **{k: row[k] for k in ['bestmove', 'score_raw', 'nodes', 'seldepth', 'qnodes',
                'qcapture_edges', 'qpromotion_edges', 'qchecked', 'qcheck_beyond_budget',
                'qevasion_edges', 'qstand_cutoffs', 'qchild_cutoffs', 'search_ms']}})
        if name.startswith('q_'):
            summary['q_eval_checks'] += row['eval_checks']
            summary['q_eval_mismatches'] += row['eval_mismatches']
            summary['q_check_nodes_beyond_nominal_budget'] += row['qcheck_beyond_budget']
(out/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
with (out/'searches.csv').open('w') as f:
    writer = csv.DictWriter(f, fieldnames=list(summary['rows'][0]), lineterminator='\n')
    writer.writeheader(); writer.writerows(summary['rows'])
print(json.dumps(summary, indent=2))
