#!/usr/bin/env python3
"""Two-position tactical-ordering gate: one new position per call; no training or matches."""
import argparse
import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path
from run_phase0_small import USI, NATIVE_OPTIONS, atomic, sha
from run_phase0b_small import check_pv, same_tree_result, decode as decode_previous

ROOT = Path(__file__).resolve().parents[1]
POSITIONS = ROOT/'experiments/phase0b-positions.json'
COMMAND = 'go depth 2 nodes 400000 movetime 3000'

def source(name):
    return next((ROOT/f'build/{name}/upstream').iterdir())/'source'

def freeze(out):
    files = ['native/phase0d_search.cpp', 'scripts/build_phase0d_shared.py',
             'scripts/build_phase0_native.py', 'scripts/run_phase0d_small.py',
             'scripts/run_phase0b_small.py', 'scripts/run_phase0_small.py', 'experiments/phase0b-positions.json']
    build = json.loads((ROOT/'build/phase0d/build.json').read_text())
    assert build['binary_sha256'] == sha(source('phase0d')/'YaneuraOu-by-gcc')
    for name in ['phase0c', 'phase0d']:
        assert sha(source(name)/'eval/nn.bin') == build['model_sha256']
    path = out/'manifest.json'
    parent = (json.loads(path.read_text())['source_base_commit'] if path.exists() else
              subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
    result = {'schema': 1, 'source_base_commit': parent, 'build': build,
              'source_sha256': {f: sha(ROOT/f) for f in files},
              'previous_binary_sha256': sha(source('phase0c')/'YaneuraOu-by-gcc'),
              'legal_reference_sha256': sha(ROOT/'build/shogi-lab'),
              'options': NATIVE_OPTIONS, 'search_command': COMMAND, 'qdepth': 2,
              'move_order': ['lexical', 'tactical'],
              'tactical_rule': 'capture OR promotion first; lexical ties',
              'positions': json.loads(POSITIONS.read_text()), 'max_new_positions_per_call': 1,
              'processes_at_once': 1, 'external_timeout_seconds': 8,
              'platform': platform.platform(), 'python': platform.python_version()}
    result['condition_sha256'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    if path.exists() and json.loads(path.read_text()) != result:
        raise RuntimeError('Conditions changed; choose a new --out directory')
    atomic(path, result)
    return result

def start(mode='alphabeta', use_q=True, previous=False, audit=True, order='tactical'):
    src = source('phase0c' if previous else 'phase0d')
    e = USI([str(src/'YaneuraOu-by-gcc')], src)
    try:
        e.send('usi'); e.until('usiok')
        for key, value in NATIVE_OPTIONS.items():
            e.send(f'setoption name {key} value {value}')
        if mode != 'standard':
            e.send('setoption name Phase0Search value ' + mode)
            e.send('setoption name Phase0Audit value ' + str(audit).lower())
            e.send('setoption name Phase0QSearch value ' + str(use_q).lower())
            e.send('setoption name Phase0QDepth value 2')
            if not previous:
                e.send('setoption name Phase0MoveOrder value ' + order)
        e.send('isready'); e.until('readyok'); e.send('usinewgame')
        return e
    except BaseException:
        e.close(); raise

def finish(e, lines, position):
    e.send('phase0stats'); lines += e.until('phase0stats ')
    row = decode_previous([s.replace('phase0d_result ', 'phase0b_result ', 1).replace('phase0c_result ', 'phase0b_result ', 1) for s in lines])
    check_pv(position, row)
    return row

def run(e, position, command=COMMAND):
    started = time.perf_counter(); e.send(command)
    row = finish(e, e.until('bestmove ', 8), position)
    row['wall_ms'] = (time.perf_counter()-started)*1000
    return row

def compare(position, out):
    result = {'position': position, 'engines': {}, 'logs': {}, 'tie_checks': {}}
    configurations = [('previous_standard', 'standard', True, 'lexical'),
                      ('standard', 'standard', False, 'lexical'),
                      ('previous_alpha', 'alphabeta', True, 'lexical'),
                      ('lexical_alpha', 'alphabeta', False, 'lexical'),
                      ('lexical_minimax', 'minimax', False, 'lexical'),
                      ('tactical_minimax', 'minimax', False, 'tactical'),
                      ('tactical_alpha', 'alphabeta', False, 'tactical')]
    try:
        for label, mode, previous, order in configurations:
            e = start(mode=mode, previous=previous, order=order)
            try:
                e.send('position sfen ' + position['sfen'])
                row = run(e, position)
                result['engines'][label] = row
                assert row['completed_depth'] == 2, row
                if mode != 'standard':
                    assert row['stop_reason'] == 'depth_limit' and row['root_restored'], row
            finally:
                e.close(); result['logs'][label] = e.log
        engines = result['engines']
        for key in ['score_usi', 'bestmove', 'pv', 'nodes', 'completed_depth']:
            assert engines['standard'][key] == engines['previous_standard'][key], key
        same_tree_result(engines['lexical_alpha'], engines['previous_alpha'])
        exact = engines['lexical_minimax']['score_raw']
        for name in ['lexical_alpha', 'tactical_minimax', 'tactical_alpha']:
            assert engines[name]['score_raw'] == exact, (name, engines)
        # Full-width traversal must visit the same tree even when its order changes.
        for key in ['nodes', 'visits', 'qnodes', 'eval_calls', 'seldepth']:
            assert engines['lexical_minimax'][key] == engines['tactical_minimax'][key], key
        candidates = sorted({engines[k]['bestmove'] for k in
                             ['lexical_minimax', 'tactical_minimax', 'lexical_alpha', 'tactical_alpha']})
        # Full-window, single-root minimax resolves any root tie instead of assuming it.
        if len(candidates) > 1:
            for move in candidates:
                e = start(mode='minimax')
                try:
                    e.send('position sfen ' + position['sfen'])
                    row = run(e, position, COMMAND + ' searchmoves ' + move)
                    assert row['completed_depth'] == 2 and row['score_raw'] == exact
                    assert row['bestmove'] == move
                    result['tie_checks'][move] = row
                finally:
                    e.close(); result['logs']['tie_' + move] = e.log
        result['ordering_node_reduction'] = 1-engines['tactical_alpha']['nodes']/engines['lexical_alpha']['nodes']
        result['passed'] = True
    except BaseException as error:
        result['error'] = str(error)
        atomic(out/f'failed/compare-{position["id"]}.json', result)
        raise
    return result


def control(position, out):
    reference = json.loads((out/f'compare/{position["id"]}.json').read_text())['engines']['tactical_alpha']
    result = {'position': position, 'searches': {}}
    e = start()
    try:
        e.send('position sfen ' + position['sfen'])
        r = run(e, position, 'go depth 2 nodes 2')
        assert r['nodes'] == 2 and r['stop_reason'] == 'node_limit' and r['qaborts'] > 0
        result['searches']['q_node_abort'] = r
        r = run(e, position); same_tree_result(reference, r)
        result['searches']['resume_after_q_abort'] = r
        e.send('setoption name Phase0Audit value false')
        r = run(e, position); same_tree_result(reference, r)
        assert r['eval_checks'] == 0
        result['searches']['audit_disabled'] = r
        e.send('setoption name Phase0Audit value true')
        e.send('setoption name Phase0Search value minimax')
        e.send('go infinite')
        lines = e.until('info depth 1 ')
        e.send('stop'); lines += e.until('bestmove ')
        r = finish(e, lines, position)
        assert r['stop_reason'] == 'external_stop', r
        result['searches']['external_stop'] = r
        e.send('setoption name Phase0Search value alphabeta')
        r = run(e, position); same_tree_result(reference, r)
        result['searches']['resume_after_external_stop'] = r
        result['passed'] = True
    except BaseException as error:
        result['error'] = str(error); result['usi_log'] = e.log
        atomic(out/f'failed/control-{position["id"]}.json', result)
        raise
    finally:
        e.close(); result['usi_log'] = e.log
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage', choices=['compare', 'control'])
    p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0d')
    args = p.parse_args(); out = args.out.resolve()
    manifest = freeze(out); positions = manifest['positions']
    if args.stage == 'control':
        for pos in positions:
            r = json.loads((out/f'compare/{pos["id"]}.json').read_text())
            assert r['passed'] and r['condition_sha256'] == manifest['condition_sha256']
    added = 0
    for pos in positions:
        path = out/f'{args.stage}/{pos["id"]}.json'
        if path.exists():
            r = json.loads(path.read_text())
            assert r['passed'] and r['condition_sha256'] == manifest['condition_sha256']
            continue
        r = compare(pos, out) if args.stage == 'compare' else control(pos, out)
        r['condition_sha256'] = manifest['condition_sha256']
        atomic(path, r); added = 1
        print(json.dumps({'saved': str(path), 'passed': r['passed']}), flush=True)
        break
    print(json.dumps({'stage': args.stage, 'new_positions': added,
                      'completed': sum((out/f'{args.stage}/{x["id"]}.json').exists() for x in positions), 'total': 2}))

if __name__ == '__main__':
    main()
