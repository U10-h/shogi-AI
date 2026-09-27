#!/usr/bin/env python3
"""Shared-native integration checks, one of two frozen positions per invocation."""
import argparse
import hashlib
import json
import platform
import queue
import re
import subprocess
import time
from pathlib import Path
from run_phase0_small import USI, NATIVE_OPTIONS, atomic, legal, sha

ROOT = Path(__file__).resolve().parents[1]
POSITIONS = ROOT/'experiments/phase0b-positions.json'
SEARCH_COMMAND = 'go depth 3 nodes 400000 movetime 3000'

def source(name):
    return next((ROOT/f'build/{name}/upstream').iterdir())/'source'

def freeze(out):
    files = ['native/phase0b_search.cpp', 'scripts/build_phase0b_shared.py',
             'scripts/build_phase0_native.py', 'scripts/run_phase0b_small.py',
             'scripts/run_phase0_small.py', 'experiments/phase0b-positions.json']
    build = json.loads((ROOT/'build/phase0b/build.json').read_text())
    assert build['binary_sha256'] == sha(source('phase0b')/'YaneuraOu-by-gcc')
    for folder in ['phase0', 'phase0b']:
        assert sha(source(folder)/'eval/nn.bin') == build['model_sha256']
    path = out/'manifest.json'
    parent = (json.loads(path.read_text())['source_base_commit'] if path.exists()
              else subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
    manifest = {'schema': 1, 'source_base_commit': parent, 'build': build,
                'source_sha256': {f: sha(ROOT/f) for f in files},
                'reference_binary_sha256': sha(source('phase0')/'YaneuraOu-by-gcc'),
                'legal_reference_sha256': sha(ROOT/'build/shogi-lab'),
                'options': NATIVE_OPTIONS, 'search_command': SEARCH_COMMAND,
                'custom_audit': True, 'positions': json.loads(POSITIONS.read_text()),
                'platform': platform.platform(), 'python': platform.python_version(),
                'stages': ['static', 'search', 'interrupt'], 'processes_at_once': 1,
                'max_new_positions_per_call': 1, 'external_timeout_seconds': 8}
    manifest['condition_sha256'] = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    if path.exists() and json.loads(path.read_text()) != manifest:
        raise RuntimeError('Conditions changed; choose a new --out directory')
    atomic(path, manifest)
    return manifest

def start(mode):
    src = source('phase0' if mode == 'reference' else 'phase0b')
    e = USI([str(src/'YaneuraOu-by-gcc')], src)
    try:
        e.send('usi'); e.until('usiok')
        for key, value in NATIVE_OPTIONS.items():
            e.send(f'setoption name {key} value {value}')
        # The standard-default case deliberately does not set the new selector.
        if mode in ['alphabeta', 'minimax']:
            e.send('setoption name Phase0Search value ' + mode)
            e.send('setoption name Phase0Audit value true')
        e.send('isready'); e.until('readyok'); e.send('usinewgame')
        return e
    except BaseException:
        e.close(); raise

def evaluate(e, sfen, moves=''):
    e.send('position sfen ' + sfen + (' moves ' + moves if moves else ''))
    e.send('eval')
    return int(e.until('eval = ')[-1].split('=')[1])

def check_pv(position, row):
    assert row['bestmove'] in legal(position['sfen']), row
    history = []
    for move in row['pv']:
        assert move in legal(position['sfen'], ' '.join(history)), (position['id'], history, move)
        history.append(move)
    if history:
        assert history[0] == row['bestmove']
    row['legal_pv_verified'] = True

def decode(lines):
    best = next(s.split()[1] for s in reversed(lines) if s.startswith('bestmove '))
    raw = next((s[len('info string phase0b_result '):] for s in lines if s.startswith('info string phase0b_result ')), None)
    if raw:
        r = json.loads(raw); r['bestmove'] = best
        assert r['root_restored'] and r['eval_mismatches'] == 0, r
        return r
    info = next(s for s in reversed(lines) if s.startswith('info depth ') and ' pv ' in s)
    final = next(s for s in lines if s.startswith('phase0stats '))
    score = re.search(r'score (cp|mate) ([^ ]+)', info)
    return {'bestmove': best, 'pv': info.split(' pv ', 1)[1].split(),
            'score_usi': [score[1], score[2]],
            'completed_depth': int(re.search(r'completed_depth (\d+)', final)[1]),
            'nodes': int(re.search(r'nodes (\d+)', final)[1])}

def finish(e, lines):
    e.send('phase0stats'); lines += e.until('phase0stats ')
    return decode(lines)

def run(e, position, command=SEARCH_COMMAND):
    t = time.perf_counter(); e.send(command)
    row = finish(e, e.until('bestmove ', 8))
    row['wall_ms'] = (time.perf_counter()-t)*1000
    check_pv(position, row)
    return row

def same_tree_result(a, b):
    for key in ['score_raw', 'pv', 'bestmove', 'completed_depth', 'nodes']:
        assert a[key] == b[key], (key, a[key], b[key])

def static_case(position):
    moves = sorted(legal(position['sfen']))
    drop = next((m for m in moves if '*' in m), moves[-1])
    histories = ['', moves[0], drop]
    result = {'histories': histories, 'scores': {}, 'logs': {}}
    for mode in ['reference', 'standard', 'alphabeta', 'minimax']:
        e = start(mode)
        try:
            result['scores'][mode] = [evaluate(e, position['sfen'], h) for h in histories]
        finally:
            e.close(); result['logs'][mode] = e.log
    assert all(s == result['scores']['reference'] for s in result['scores'].values())
    perft = {}
    for depth in [1, 2, 3]:
        raw = subprocess.check_output([str(ROOT/'build/shogi-lab'), '--sfen', position['sfen'],
                                       '--perft', str(depth)], text=True, timeout=5)
        perft[depth] = json.loads(raw)['perft']
    result['perft'] = perft
    result['expected_minimax_nodes'] = 3*perft[1] + 2*perft[2] + perft[3]
    result['passed'] = True
    return result

def search_case(position, out):
    result = {'engines': {}, 'logs': {}}
    for mode in ['reference', 'standard', 'minimax', 'alphabeta']:
        e = start(mode)
        try:
            e.send('position sfen ' + position['sfen'])
            row = run(e, position)
            assert row['completed_depth'] == 3, row
            result['engines'][mode] = row
        finally:
            e.close(); result['logs'][mode] = e.log
    a, b = result['engines']['minimax'], result['engines']['alphabeta']
    for key in ['score_raw', 'bestmove', 'pv']:
        assert a[key] == b[key], (key, a[key], b[key])
    expected = json.loads((out/f'static/{position["id"]}.json').read_text())['expected_minimax_nodes']
    assert a['nodes'] == expected, (a['nodes'], expected)
    for key in ['score_usi', 'bestmove', 'pv', 'nodes', 'completed_depth']:
        assert result['engines']['reference'][key] == result['engines']['standard'][key], key
    result['alpha_beta_node_reduction'] = 1-b['nodes']/a['nodes']
    result['passed'] = True
    return result

def interrupt_case(position, out):
    reference = json.loads((out/f'search/{position["id"]}.json').read_text())['engines']['alphabeta']
    result = {'searches': {}, 'checks': {}}
    e = start('alphabeta')
    try:
        e.send('position sfen ' + position['sfen'])
        r = run(e, position, 'go depth 3 nodes 1')
        assert r['nodes'] == 1 and not r['has_result'] and r['stop_reason'] == 'node_limit'
        result['searches']['node_abort'] = r
        # No position command: verify that the actual runtime can start again after abort.
        r = run(e, position); same_tree_result(reference, r)
        result['searches']['after_node_abort'] = r
        e.send('setoption name Phase0Search value minimax')
        e.send('go infinite')
        lines = e.until('info depth 1 ')
        e.send('stop'); lines += e.until('bestmove ')
        r = finish(e, lines); check_pv(position, r)
        assert r['stop_reason'] == 'external_stop', r
        result['searches']['external_stop'] = r
        e.send('setoption name Phase0Search value alphabeta')
        r = run(e, position); same_tree_result(reference, r)
        result['searches']['after_external_stop'] = r
        # Reaching the internal node ceiling must still respect USI infinite semantics.
        e.send('go infinite nodes 1')
        lines = e.until('info string phase0b_result ')
        try:
            extra = e.q.get(timeout=0.03)
            raise AssertionError('Unexpected output before stop: ' + str(extra))
        except queue.Empty:
            pass
        e.send('stop'); lines += e.until('bestmove ')
        r = finish(e, lines); check_pv(position, r)
        result['searches']['infinite_wait'] = r
        result['checks'] = {'node_cap_exact': True, 'node_abort_resume_exact': True,
                            'external_stop_seen': True, 'external_abort_resume_exact': True,
                            'infinite_does_not_emit_bestmove_before_stop': True}
        result['passed'] = True
    finally:
        e.close(); result['usi_log'] = e.log
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage', choices=['static', 'search', 'interrupt'])
    p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0b')
    args = p.parse_args(); out = args.out.resolve()
    manifest = freeze(out)
    positions = manifest['positions']
    previous = {'search': 'static', 'interrupt': 'search'}.get(args.stage)
    if previous:
        for position in positions:
            old = json.loads((out/f'{previous}/{position["id"]}.json').read_text())
            assert old['passed'] and old['condition_sha256'] == manifest['condition_sha256']
    added = 0
    for position in positions:
        path = out/f'{args.stage}/{position["id"]}.json'
        if path.exists():
            old = json.loads(path.read_text())
            assert old['condition_sha256'] == manifest['condition_sha256'] and old['passed']
            continue
        if args.stage == 'static':
            result = static_case(position)
        elif args.stage == 'search':
            result = search_case(position, out)
        else:
            result = interrupt_case(position, out)
        result.update(position=position, condition_sha256=manifest['condition_sha256'])
        atomic(path, result)
        added += 1
        print(json.dumps({'saved': str(path), 'passed': result['passed']}), flush=True)
        break
    print(json.dumps({'stage': args.stage, 'new_positions': added,
                      'completed': sum((out/f'{args.stage}/{r["id"]}.json').exists() for r in positions), 'total': len(positions)}))

if __name__ == '__main__':
    main()
