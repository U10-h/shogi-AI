#!/usr/bin/env python3
"""One fixed middle-game position, one bounded search checkpoint per invocation."""
import argparse
import hashlib
import json
import platform
import subprocess
from pathlib import Path
from run_phase0_small import atomic, sha, NATIVE_OPTIONS
from run_phase0d_small import start, run, source, COMMAND
from run_phase0b_small import same_tree_result

ROOT = Path(__file__).resolve().parents[1]
CONFIGS = [('lexical_minimax', 'minimax', 'lexical'),
           ('tactical_minimax', 'minimax', 'tactical'),
           ('lexical_alpha', 'alphabeta', 'lexical'),
           ('tactical_alpha', 'alphabeta', 'tactical')]
SAFE_STOPS = {'depth_limit', 'pilot_node_cap', 'node_limit', 'pilot_time_cap',
              'time_limit', 'q_ply_guard'}


def freeze(out):
    files = ['scripts/run_phase0e_middle.py', 'scripts/run_phase0d_small.py',
             'scripts/run_phase0b_small.py', 'scripts/run_phase0_small.py',
             'scripts/build_phase0d_shared.py', 'scripts/build_phase0_native.py',
             'native/phase0d_search.cpp', 'experiments/phase0e-positions.json']
    build = json.loads((ROOT/'build/phase0d/build.json').read_text())
    assert sha(source('phase0d')/'YaneuraOu-by-gcc') == build['binary_sha256']
    assert sha(source('phase0d')/'eval/nn.bin') == build['model_sha256']
    assert sha(ROOT/'native/phase0d_search.cpp') == build['patched_sources']['phase0d_search.cpp']
    path = out/'manifest.json'
    parent = (json.loads(path.read_text())['source_base_commit'] if path.exists() else
              subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
    result = {'schema': 1, 'source_base_commit': parent, 'build': build,
              'source_sha256': {f: sha(ROOT/f) for f in files},
              'legal_reference_sha256': sha(ROOT/'build/shogi-lab'),
              'options': NATIVE_OPTIONS, 'search_command': COMMAND, 'audit': True,
              'positions': json.loads((ROOT/'experiments/phase0e-positions.json').read_text()),
              'configurations': CONFIGS, 'processes_at_once': 1,
              'max_comparison_searches_per_call': 1, 'external_timeout_seconds': 8,
              'incomplete_policy': 'Save stop and restoration evidence; do not compare unequal or uncompleted horizons as exact depth-2 results.',
              'platform': platform.platform(), 'python': platform.python_version()}
    # Normalize tuples before comparing an existing JSON manifest.
    result = json.loads(json.dumps(result))
    result['condition_sha256'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    if path.exists() and json.loads(path.read_text()) != result:
        raise RuntimeError('Conditions changed; choose a new --out directory')
    atomic(path, result)
    return result


def valid(row):
    assert row['root_restored'] and row['legal_pv_verified'] and row['eval_mismatches'] == 0, row
    assert row['nodes'] <= 400000 and row['completed_depth'] <= 2, row
    assert row['stop_reason'] in SAFE_STOPS, row
    assert row['has_result'] == (row['completed_depth'] > 0), row
    if not row['has_result']:
        assert row['score_raw'] is None and not row['pv'], row


def compare_one(position, out, manifest):
    for label, mode, order in CONFIGS:
        path = out/f'compare/{label}.json'
        if path.exists():
            old = json.loads(path.read_text())
            assert old['checked'] and old['condition_sha256'] == manifest['condition_sha256']
            continue
        result = {'position': position, 'label': label, 'mode': mode, 'order': order,
                  'condition_sha256': manifest['condition_sha256']}
        e = start(mode=mode, order=order)
        try:
            e.send('position sfen ' + position['sfen'])
            result['search'] = row = run(e, position)
            valid(row)
            result['target_completed'] = row['completed_depth'] == 2 and row['stop_reason'] == 'depth_limit'
            result['checked'] = True
        except BaseException as error:
            result['error'] = str(error)
            e.close(); result['usi_log'] = e.log
            atomic(out/f'failed/{label}.json', result)
            raise
        else:
            e.close(); result['usi_log'] = e.log
        atomic(path, result)
        print(json.dumps({'saved': str(path), 'label': label, 'target_completed': result['target_completed'],
                          **{k:row[k] for k in ['nodes','completed_depth','stop_reason','score_raw','bestmove','search_ms']}}))
        return
    print(json.dumps({'new_searches': 0, 'completed_checkpoints': len(CONFIGS)}))


def control_one(position, out, manifest):
    # One configuration per call; repeat immediately without resetting position.
    for label, mode, order in CONFIGS:
        path = out/f'control/{label}.json'
        if path.exists():
            old = json.loads(path.read_text())
            assert old['checked'] and old['condition_sha256'] == manifest['condition_sha256']
            continue
        reference = json.loads((out/f'compare/{label}.json').read_text())['search']
        result = {'label': label, 'condition_sha256': manifest['condition_sha256'], 'searches': {}}
        e = start(mode=mode, order=order)
        try:
            e.send('position sfen ' + position['sfen'])
            # After a forced two-node abort, all board/evaluator state must be restored.
            row = run(e, position, 'go depth 2 nodes 2')
            valid(row)
            assert row['nodes'] == 2 and row['stop_reason'] == 'node_limit'
            result['searches']['node_abort'] = row
            row = run(e, position)
            valid(row)
            if reference['stop_reason'] not in {'pilot_time_cap', 'time_limit'}:
                same_tree_result(reference, row)
                assert row['stop_reason'] == reference['stop_reason']
            result['searches']['resume'] = row
            # A natural guard/cap abort also leaves the next search unchanged.
            row2 = run(e, position)
            valid(row2)
            if row['stop_reason'] not in {'pilot_time_cap', 'time_limit'}:
                same_tree_result(row, row2)
                assert row2['stop_reason'] == row['stop_reason']
            result['searches']['repeat_without_position'] = row2
            result['checked'] = True
        except BaseException as error:
            result['error'] = str(error)
            e.close(); result['usi_log'] = e.log
            atomic(out/f'failed/control-{label}.json', result)
            raise
        else:
            e.close(); result['usi_log'] = e.log
        atomic(path, result)
        print(json.dumps({'saved': str(path), 'label': label, 'checked': True}))
        return
    print(json.dumps({'new_searches': 0, 'completed_checkpoints': len(CONFIGS)}))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage', choices=['compare', 'control'])
    p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0e')
    args = p.parse_args(); out = args.out.resolve()
    manifest = freeze(out)
    assert len(manifest['positions']) == 1
    if args.stage == 'control':
        assert all((out/f'compare/{label}.json').exists() for label, _, _ in CONFIGS)
    (compare_one if args.stage == 'compare' else control_one)(manifest['positions'][0], out, manifest)


if __name__ == '__main__':
    main()
