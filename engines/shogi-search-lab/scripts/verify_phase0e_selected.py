#!/usr/bin/env python3
"""Post-comparison diagnostic: exact minimax value for the one agreed root move."""
import argparse
import hashlib
import json
from pathlib import Path
from run_phase0_small import atomic, sha
from run_phase0d_small import start, run, COMMAND
from run_phase0e_middle import freeze, valid, ROOT


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, default=ROOT/'results/v1.0-phase0e')
    out = p.parse_args().out.resolve()
    manifest = freeze(out)
    inputs = [out/f'compare/{label}.json' for label in ['lexical_alpha', 'tactical_alpha']]
    a, b = [json.loads(path.read_text()) for path in inputs]
    for row in [a, b]:
        assert row['target_completed'] and row['condition_sha256'] == manifest['condition_sha256']
    assert a['search']['bestmove'] == b['search']['bestmove']
    assert a['search']['score_raw'] == b['search']['score_raw']
    move = a['search']['bestmove']
    command = COMMAND + ' searchmoves ' + move
    config = {'parent_condition_sha256': manifest['condition_sha256'],
              'source_sha256': sha(Path(__file__)),
              'comparison_sha256': {str(p.relative_to(out)): sha(p) for p in inputs},
              'position': manifest['positions'][0], 'mode': 'minimax', 'order': 'lexical',
              'command': command, 'audit': True,
              'selection_rule': 'Post-hoc diagnostic of the single move selected by both completed alpha-beta searches.',
              'claim_limit': 'Checks the exact value of this root move only, not optimality among all root moves.'}
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    path = out/'selected_move.json'
    if path.exists():
        old = json.loads(path.read_text())
        assert old['condition_sha256'] == digest and old['checked']
        print(json.dumps({'new_searches': 0, 'saved': str(path)})); return
    result = {'config': config, 'condition_sha256': digest}
    e = start(mode='minimax', order='lexical')
    try:
        e.send('position sfen ' + config['position']['sfen'])
        result['search'] = row = run(e, config['position'], command)
        valid(row)
        result['target_completed'] = row['completed_depth'] == 2 and row['stop_reason'] == 'depth_limit'
        result['agrees_with_alpha'] = (row['score_raw'] == a['search']['score_raw'] and row['bestmove'] == move
                                      if result['target_completed'] else None)
        result['checked'] = True
    except BaseException as error:
        result['error'] = str(error)
        e.close(); result['usi_log'] = e.log
        atomic(out/'failed/selected_move.json', result)
        raise
    else:
        e.close(); result['usi_log'] = e.log
    atomic(path, result)
    assert result['agrees_with_alpha'] is not False, result
    print(json.dumps({'saved': str(path), 'target_completed': result['target_completed'],
                      'agrees_with_alpha': result['agrees_with_alpha'],
                      **{k:row[k] for k in ['nodes','completed_depth','stop_reason','score_raw','bestmove','search_ms']}}))


if __name__ == '__main__':
    main()
