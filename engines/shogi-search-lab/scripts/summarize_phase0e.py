#!/usr/bin/env python3
"""Keep completed and capped horizons separate in the middle-game summary."""
import argparse
import csv
import json
import re
from pathlib import Path
from run_phase0_small import atomic
from run_phase0e_middle import CONFIGS, ROOT, valid


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0e')
    out = p.parse_args().out.resolve()
    manifest = json.loads((out/'manifest.json').read_text())
    summary = {'condition_sha256': manifest['condition_sha256'], 'positions': 1,
               'comparison_searches': 0, 'control_searches': 0, 'selected_move_searches': 1,
               'comparison_and_selected_eval_checks': 0, 'all_eval_checks': 0,
               'all_eval_mismatches': 0, 'rows': [], 'controls': [], 'first_iterations': [],
               'full_width_depth2_verified': False}
    comparisons = {}
    fields = ['nodes', 'completed_depth', 'seldepth', 'score_raw', 'bestmove', 'stop_reason',
              'qnodes', 'eval_checks', 'eval_mismatches', 'main_order_changes', 'q_order_changes',
              'cutoffs', 'main_first_cutoffs', 'qchild_cutoffs', 'q_first_cutoffs',
              'qcheck_beyond_budget', 'search_ms', 'root_restored']

    def count(row, comparison=False):
        valid(row)
        summary['all_eval_checks'] += row['eval_checks']
        summary['all_eval_mismatches'] += row['eval_mismatches']
        if comparison:
            summary['comparison_and_selected_eval_checks'] += row['eval_checks']

    for label, _, _ in CONFIGS:
        r = json.loads((out/f'compare/{label}.json').read_text())
        assert r['checked'] and r['condition_sha256'] == manifest['condition_sha256']
        comparisons[label] = row = r['search']; count(row, True)
        summary['comparison_searches'] += 1
        summary['rows'].append({'label': label, 'target_completed': r['target_completed'],
                                 **{k:row[k] for k in fields}})
        first = next(s for s in r['usi_log'] if s.startswith('< info depth 1 '))
        score = re.search(r'score (cp|mate) (-?\d+)', first)
        summary['first_iterations'].append({'label': label, 'score_usi': [score[1], int(score[2])],
            'nodes': int(re.search(r'nodes (\d+)', first)[1]), 'pv': first.split(' pv ', 1)[1].split()})
        control = json.loads((out/f'control/{label}.json').read_text())
        assert control['checked'] and control['condition_sha256'] == manifest['condition_sha256']
        for name, row in control['searches'].items():
            count(row); summary['control_searches'] += 1
            summary['controls'].append({'label': label, 'case': name,
                **{k:row[k] for k in ['nodes','completed_depth','stop_reason','root_restored']}})

    a, b = comparisons['lexical_alpha'], comparisons['tactical_alpha']
    assert a['completed_depth'] == b['completed_depth'] == 2
    for key in ['score_raw', 'bestmove', 'pv']:
        assert a[key] == b[key]
    summary['alpha_comparison'] = {'lexical_nodes': a['nodes'], 'tactical_nodes': b['nodes'],
        'saved_nodes': a['nodes']-b['nodes'], 'node_reduction': 1-b['nodes']/a['nodes'],
        'same_score': True, 'same_bestmove': True, 'same_pv': True,
        'score_raw': a['score_raw'], 'bestmove': a['bestmove'], 'pv': a['pv']}
    for label in ['lexical_minimax', 'tactical_minimax']:
        assert comparisons[label]['stop_reason'] == 'pilot_node_cap'
        assert comparisons[label]['completed_depth'] == 1
    selected = json.loads((out/'selected_move.json').read_text())
    assert selected['checked'] and selected['config']['parent_condition_sha256'] == manifest['condition_sha256']
    count(selected['search'], True)
    summary['selected_move_check'] = {'target_completed': selected['target_completed'],
        'agrees_with_alpha': selected['agrees_with_alpha'],
        **{k:selected['search'][k] for k in ['nodes','score_raw','bestmove','pv']},
        'all_root_moves_verified': False}
    atomic(out/'summary.json', summary)
    with (out/'searches.csv').open('w') as f:
        w = csv.DictWriter(f, fieldnames=list(summary['rows'][0]), lineterminator='\n')
        w.writeheader(); w.writerows(summary['rows'])
    print(json.dumps({k:v for k,v in summary.items() if k not in ['rows','controls','first_iterations']}, indent=2))


if __name__ == '__main__':
    main()
