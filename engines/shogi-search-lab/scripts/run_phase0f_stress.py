#!/usr/bin/env python3
"""Small factorial ordering study; one position per call, checkpoint every search."""
import argparse
import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path
from run_phase0_small import USI, NATIVE_OPTIONS, atomic, sha
from run_phase0b_small import check_pv, same_tree_result, decode
from run_phase0d_small import source, COMMAND
from run_phase0e_middle import valid

ROOT = Path(__file__).resolve().parents[1]
CONFIGS = [('minimax', 'minimax', 'lexical', False),
           ('previous_lexical', 'alphabeta', 'lexical', True),
           ('lexical', 'alphabeta', 'lexical', False),
           ('main', 'alphabeta', 'main', False),
           ('q', 'alphabeta', 'q', False),
           ('tactical', 'alphabeta', 'tactical', False),
           ('previous_tactical', 'alphabeta', 'tactical', True)]
ORDERS = ['lexical', 'main', 'q', 'tactical']


def freeze(out):
    files = ['native/phase0f_search.cpp', 'scripts/build_phase0f_shared.py',
             'scripts/build_phase0_native.py', 'scripts/run_phase0f_stress.py',
             'scripts/run_phase0e_middle.py', 'scripts/run_phase0d_small.py',
             'scripts/run_phase0b_small.py', 'scripts/run_phase0_small.py',
             'experiments/phase0f-positions.json']
    build = json.loads((ROOT/'build/phase0f/build.json').read_text())
    assert sha(source('phase0f')/'YaneuraOu-by-gcc') == build['binary_sha256']
    assert sha(ROOT/'native/phase0f_search.cpp') == build['patched_sources']['phase0f_search.cpp']
    for name in ['phase0d', 'phase0f']:
        assert sha(source(name)/'eval/nn.bin') == build['model_sha256']
    path = out/'manifest.json'
    parent = (json.loads(path.read_text())['source_base_commit'] if path.exists() else
              subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip())
    result = {'schema': 1, 'source_base_commit': parent, 'build': build,
              'source_sha256': {f: sha(ROOT/f) for f in files},
              'previous_binary_sha256': sha(source('phase0d')/'YaneuraOu-by-gcc'),
              'legal_reference_sha256': sha(ROOT/'build/shogi-lab'),
              'options': NATIVE_OPTIONS, 'command': COMMAND, 'audit': True,
              'positions': json.loads((ROOT/'experiments/phase0f-positions.json').read_text()),
              'configurations': CONFIGS, 'max_new_positions_per_call': 1,
              'processes_at_once': 1, 'external_timeout_seconds': 8,
              'checkpoint_policy': 'Save each search, including guard/cap aborts; stop on invariant failure.',
              'platform': platform.platform(), 'python': platform.python_version()}
    result = json.loads(json.dumps(result))
    result['condition_sha256'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    if path.exists() and json.loads(path.read_text()) != result:
        raise RuntimeError('Conditions changed; use a new --out')
    atomic(path, result)
    return result


def start(mode='alphabeta', order='tactical', previous=False):
    src = source('phase0d' if previous else 'phase0f')
    e = USI([str(src/'YaneuraOu-by-gcc')], src)
    try:
        e.send('usi'); e.until('usiok')
        for key, value in NATIVE_OPTIONS.items():
            e.send(f'setoption name {key} value {value}')
        for key, value in {'Phase0Search':mode, 'Phase0MoveOrder':order,
                           'Phase0Audit':'true', 'Phase0QSearch':'true', 'Phase0QDepth':'2'}.items():
            e.send(f'setoption name {key} value {value}')
        e.send('isready'); e.until('readyok'); e.send('usinewgame')
        return e
    except BaseException:
        e.close(); raise


def run(e, position, command=COMMAND):
    t = time.perf_counter(); e.send(command)
    lines = e.until('bestmove ', 8)
    e.send('phase0stats'); lines += e.until('phase0stats ')
    row = decode([s.replace('phase0f_result ', 'phase0b_result ', 1)
                    .replace('phase0d_result ', 'phase0b_result ', 1) for s in lines])
    row['wall_ms'] = (time.perf_counter()-t)*1000
    check_pv(position, row); valid(row)
    if 'guard_path' in row and row['stop_reason'] == 'q_ply_guard':
        history = row['guard_path']
        assert len(history) == row['guard_ply'] == 8
        check_pv(position, {'bestmove':history[0], 'pv':history})
        replay = json.loads(subprocess.check_output([str(ROOT/'build/shogi-lab'), '--legal',
            '--sfen', position['sfen'], '--moves', ' '.join(history)], text=True, timeout=3))
        assert replay['sfen'].split()[:3] == row['guard_sfen'].split()[:3]
        assert replay['in_check'] == row['guard_checked']
        row['guard_replay_verified'] = True
    return row


def checkpoint(path, manifest, position, mode, order, previous=False, command=COMMAND):
    if path.exists():
        r = json.loads(path.read_text())
        assert r['checked'] and r['condition_sha256'] == manifest['condition_sha256']
        return r
    r = {'position':position, 'mode':mode, 'order':order, 'previous':previous,
         'command':command, 'condition_sha256':manifest['condition_sha256']}
    e = start(mode, order, previous)
    try:
        e.send('position sfen ' + position['sfen'])
        r['search'] = row = run(e, position, command)
        r['target_completed'] = row['completed_depth'] == 2 and row['stop_reason'] == 'depth_limit'
        r['checked'] = True
    except BaseException as error:
        r['error'] = str(error)
        e.close(); r['usi_log'] = e.log
        atomic(path.parent/'failed'/path.name, r); raise
    else:
        e.close(); r['usi_log'] = e.log
    atomic(path, r)
    print(json.dumps({'saved':str(path), **{k:row[k] for k in
        ['nodes','completed_depth','stop_reason','score_raw','bestmove']}}), flush=True)
    return r


def compare(position, out, manifest):
    rows = {}
    for label, mode, order, previous in CONFIGS:
        rows[label] = checkpoint(out/f'compare/{position["id"]}/{label}.json',
                                  manifest, position, mode, order, previous)['search']
    for order in ['lexical', 'tactical']:
        a, b = rows['previous_'+order], rows[order]
        if a['stop_reason'] not in {'time_limit','pilot_time_cap'} and b['stop_reason'] not in {'time_limit','pilot_time_cap'}:
            same_tree_result(a, b)
            assert a['stop_reason'] == b['stop_reason']
    # Compare only results at the same *completed* horizon.
    horizon_scores = {}
    for order in ORDERS:
        for iteration in rows[order]['iterations']:
            depth = iteration['depth']; score = iteration['score_raw']
            if depth in horizon_scores:
                assert horizon_scores[depth] == score, (position['id'], order, depth, horizon_scores, score)
            horizon_scores[depth] = score
    for iteration in rows['minimax']['iterations']:
        assert horizon_scores.get(iteration['depth'], iteration['score_raw']) == iteration['score_raw']
    atomic(out/f'compare/{position["id"]}/complete.json',
           {'checked':True, 'condition_sha256':manifest['condition_sha256'], 'horizon_scores':horizon_scores})


def diagnose(position, out, manifest):
    comparisons = {label:json.loads((out/f'compare/{position["id"]}/{label}.json').read_text())
                   for label in ['minimax', *ORDERS]}
    selected = {}
    # Only completed depth-2 choices are eligible; do not certify fallback moves.
    moves = sorted({comparisons[o]['search']['bestmove'] for o in ORDERS if comparisons[o]['target_completed']})
    if not comparisons['minimax']['target_completed']:
        for move in moves:
            r = checkpoint(out/f'diagnose/{position["id"]}/selected-{move}.json', manifest,
                           position, 'minimax', 'lexical', command=COMMAND+' searchmoves '+move)
            agrees = None
            if r['target_completed']:
                relevant = [comparisons[o]['search']['score_raw'] for o in ORDERS
                            if comparisons[o]['target_completed'] and comparisons[o]['search']['bestmove'] == move]
                agrees = all(r['search']['score_raw'] == score for score in relevant)
                assert agrees, (move, r, relevant)
            selected[move] = {'target_completed':r['target_completed'], 'score_agrees':agrees}
    # Two searches per position: forced node abort, then unchanged-position resume.
    path = out/f'diagnose/{position["id"]}/restore.json'
    if not path.exists():
        result = {'condition_sha256':manifest['condition_sha256'], 'searches':{}}
        e = start()
        try:
            e.send('position sfen '+position['sfen'])
            row = run(e, position, 'go depth 2 nodes 2')
            assert row['nodes'] == 2 and row['stop_reason'] == 'node_limit'
            result['searches']['abort'] = row
            row = run(e, position); result['searches']['resume'] = row
            reference = comparisons['tactical']['search']
            if reference['stop_reason'] not in {'time_limit','pilot_time_cap'} and row['stop_reason'] not in {'time_limit','pilot_time_cap'}:
                same_tree_result(reference, row)
                assert reference['stop_reason'] == row['stop_reason']
                assert reference['guard_path'] == row['guard_path']
            result['checked'] = True
        except BaseException as error:
            result['error'] = str(error)
            e.close(); result['usi_log'] = e.log
            atomic(path.parent/'failed'/path.name, result); raise
        else:
            e.close(); result['usi_log'] = e.log
        atomic(path, result)
    else:
        r = json.loads(path.read_text())
        assert r['checked'] and r['condition_sha256'] == manifest['condition_sha256']
    atomic(out/f'diagnose/{position["id"]}/complete.json',
           {'checked':True, 'condition_sha256':manifest['condition_sha256'],
            'selected':selected, 'scope':'Selected moves only; not a full-root minimax optimality certificate.'})


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage', choices=['compare','diagnose'])
    p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0f')
    args=p.parse_args(); out=args.out.resolve(); manifest=freeze(out)
    if args.stage == 'diagnose':
        assert all((out/f'compare/{pos["id"]}/complete.json').exists() for pos in manifest['positions'])
    for pos in manifest['positions']:
        path=out/f'{args.stage}/{pos["id"]}/complete.json'
        if path.exists():
            r=json.loads(path.read_text())
            assert r['checked'] and r['condition_sha256']==manifest['condition_sha256']
            continue
        (compare if args.stage=='compare' else diagnose)(pos,out,manifest)
        print(json.dumps({'stage':args.stage,'new_positions':1,'position':pos['id']})); return
    print(json.dumps({'stage':args.stage,'new_positions':0,'completed':len(manifest['positions'])}))


if __name__=='__main__':
    main()
