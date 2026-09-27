#!/usr/bin/env python3
"""Two-position qsearch gate: one new position per call; no training or matches."""
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
    files = ['native/phase0c_search.cpp', 'scripts/build_phase0c_shared.py',
             'scripts/build_phase0_native.py', 'scripts/run_phase0c_small.py',
             'scripts/run_phase0b_small.py', 'scripts/run_phase0_small.py', 'experiments/phase0b-positions.json']
    build = json.loads((ROOT/'build/phase0c/build.json').read_text())
    assert build['binary_sha256'] == sha(source('phase0c')/'YaneuraOu-by-gcc')
    for name in ['phase0b', 'phase0c']:
        assert sha(source(name)/'eval/nn.bin') == build['model_sha256']
    path = out/'manifest.json'
    parent = (json.loads(path.read_text())['source_base_commit'] if path.exists() else
              subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
    result = {'schema': 1, 'source_base_commit': parent, 'build': build,
              'source_sha256': {f: sha(ROOT/f) for f in files},
              'previous_binary_sha256': sha(source('phase0b')/'YaneuraOu-by-gcc'),
              'legal_reference_sha256': sha(ROOT/'build/shogi-lab'),
              'options': NATIVE_OPTIONS, 'search_command': COMMAND, 'qdepth': 2,
              'positions': json.loads(POSITIONS.read_text()), 'max_new_positions_per_call': 1,
              'processes_at_once': 1, 'external_timeout_seconds': 8,
              'platform': platform.platform(), 'python': platform.python_version()}
    result['condition_sha256'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    if path.exists() and json.loads(path.read_text()) != result:
        raise RuntimeError('Conditions changed; choose a new --out directory')
    atomic(path, result)
    return result

def start(mode='alphabeta', use_q=True, previous=False, audit=True):
    src = source('phase0b' if previous else 'phase0c')
    e = USI([str(src/'YaneuraOu-by-gcc')], src)
    try:
        e.send('usi'); e.until('usiok')
        for key, value in NATIVE_OPTIONS.items():
            e.send(f'setoption name {key} value {value}')
        if mode != 'standard':
            e.send('setoption name Phase0Search value ' + mode)
            e.send('setoption name Phase0Audit value ' + str(audit).lower())
            if not previous:
                e.send('setoption name Phase0QSearch value ' + str(use_q).lower())
                e.send('setoption name Phase0QDepth value 2')
        e.send('isready'); e.until('readyok'); e.send('usinewgame')
        return e
    except BaseException:
        e.close(); raise

def finish(e, lines, position):
    e.send('phase0stats'); lines += e.until('phase0stats ')
    row = decode_previous([s.replace('phase0c_result ', 'phase0b_result ', 1) for s in lines])
    check_pv(position, row)
    return row

def run(e, position, command=COMMAND):
    started = time.perf_counter(); e.send(command)
    row = finish(e, e.until('bestmove ', 8), position)
    row['wall_ms'] = (time.perf_counter()-started)*1000
    return row

def compare(position, out):
    result = {'position': position, 'engines': {}, 'logs': {}}
    configurations = [('previous_standard', 'standard', False, True),
                      ('standard', 'standard', False, False),
                      ('previous_plain', 'alphabeta', False, True),
                      ('plain', 'alphabeta', False, False),
                      ('q_minimax', 'minimax', True, False),
                      ('q_alphabeta', 'alphabeta', True, False)]
    for label, mode, use_q, previous in configurations:
        e = start(mode, use_q, previous)
        try:
            e.send('position sfen ' + position['sfen'])
            row = run(e, position)
            result['engines'][label] = row
            assert row['completed_depth'] == 2, row
            if mode != 'standard':
                assert row['stop_reason'] == 'depth_limit' and row['root_restored'], row
        except BaseException as error:
            result['error'] = str(error); result['logs'][label] = e.log
            atomic(out/f'failed/compare-{position["id"]}.json', result)
            raise
        finally:
            e.close(); result['logs'][label] = e.log
    engines = result['engines']
    for key in ['score_usi', 'bestmove', 'pv', 'nodes', 'completed_depth']:
        assert engines['standard'][key] == engines['previous_standard'][key], key
    same_tree_result(engines['plain'], engines['previous_plain'])
    for key in ['score_raw', 'bestmove', 'pv', 'completed_depth']:
        assert engines['q_alphabeta'][key] == engines['q_minimax'][key], (key, engines)
    result['q_vs_plain_bestmove_changed'] = engines['plain']['bestmove'] != engines['q_alphabeta']['bestmove']
    result['q_alpha_beta_node_reduction'] = 1-engines['q_alphabeta']['nodes']/engines['q_minimax']['nodes']
    result['passed'] = True
    return result

def control(position, out):
    reference = json.loads((out/f'compare/{position["id"]}.json').read_text())['engines']['q_alphabeta']
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
    p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0c')
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
