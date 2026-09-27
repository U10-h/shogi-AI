#!/usr/bin/env python3
"""Summarize factorial nodes, regressions, guarded paths, and exact-value limits."""
import argparse
import csv
import json
from run_phase0_small import atomic, legal
from run_phase0f_stress import ROOT, CONFIGS, ORDERS
from pathlib import Path


def root_ranks(position, best):
    occupied = set()
    for rank, line in enumerate(position['sfen'].split()[0].split('/')):
        col = 0
        for char in line:
            if char == '+':
                continue
            if char.isdigit():
                col += int(char)
            else:
                occupied.add(str(9-col)+chr(97+rank)); col += 1
        assert col == 9
    def tactical(move):
        return move.endswith('+') or ('*' not in move and move[2:4] in occupied)
    moves = sorted(legal(position['sfen']))
    ordered = sorted(moves, key=lambda move:(not tactical(move), move))
    return {'legal_count':len(moves), 'tactical_count':sum(map(tactical,moves)),
            'selected_move':best, 'selected_is_tactical':tactical(best),
            'selected_lexical_rank':moves.index(best)+1,
            'selected_tactical_rank':ordered.index(best)+1}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',type=Path,default=ROOT/'results/v1.0-phase0f')
    out=p.parse_args().out.resolve()
    manifest=json.loads((out/'manifest.json').read_text())
    summary={'condition_sha256':manifest['condition_sha256'], 'positions':[], 'rows':[],
             'comparison_searches':0,'selected_searches':0,'control_searches':0,
             'eval_checks':0,'eval_mismatches':0,'guard_replay_checks':0,
             'depth2_alpha_completed':0,'depth2_full_width_completed':0}
    fields=['nodes','completed_depth','score_raw','bestmove','seldepth','stop_reason',
            'qnodes','qchecked','qcheck_beyond_budget','cutoffs','main_first_cutoffs',
            'qchild_cutoffs','q_first_cutoffs','main_order_changes','q_order_changes',
            'search_ms']
    def count(row):
        assert row['root_restored'] and row['legal_pv_verified'] and row['eval_mismatches']==0
        summary['eval_checks']+=row['eval_checks']
        summary['eval_mismatches']+=row['eval_mismatches']
        summary['guard_replay_checks']+=int(row.get('guard_replay_verified',False))
    for pos in manifest['positions']:
        records={}
        for label,_,_,_ in CONFIGS:
            r=json.loads((out/f'compare/{pos["id"]}/{label}.json').read_text())
            assert r['checked'] and r['condition_sha256']==manifest['condition_sha256']
            records[label]=row=r['search']; count(row)
            summary['comparison_searches']+=1
            if label in ORDERS or label=='minimax':
                summary['rows'].append({'position':pos['id'],'mode':label,**{k:row[k] for k in fields}})
            if label in ORDERS: summary['depth2_alpha_completed']+=int(r['target_completed'])
            if label=='minimax': summary['depth2_full_width_completed']+=int(r['target_completed'])
        rows=[records[k] for k in ORDERS]
        comparable=all(r['completed_depth']==2 for r in rows)
        item={'id':pos['id'],'comparable_depth2':comparable,
              'nodes':{k:records[k]['nodes'] for k in ORDERS},
              'same_score':len({r['score_raw'] for r in rows})==1 if comparable else None,
              'same_bestmove':len({r['bestmove'] for r in rows})==1 if comparable else None,
              'same_pv':len({tuple(r['pv']) for r in rows})==1 if comparable else None,
              'root':{k:records['lexical'][k] for k in ['root_legal','root_captures','root_promotions','root_checks']},
              'reference':{k:records['minimax'][k] for k in ['nodes','completed_depth','stop_reason','guard_checked','guard_left','guard_path','guard_sfen']},
              'selected_checks':[]}
        if comparable:
            base,main,q,both=[records[k]['nodes'] for k in ORDERS]
            item['reduction']={'main':1-main/base,'q':1-q/base,'tactical':1-both/base}
            item['nonadditivity_nodes']=both-main-q+base
            item['root_order_diagnostic']=root_ranks(pos,records['tactical']['bestmove'])
            assert item['root_order_diagnostic']['legal_count']==records['lexical']['root_legal']
        for pth in sorted((out/f'diagnose/{pos["id"]}').glob('selected-*.json')):
            r=json.loads(pth.read_text()); count(r['search']); summary['selected_searches']+=1
            item['selected_checks'].append({'command':r['command'],'completed':r['target_completed'],
                **{k:r['search'][k] for k in ['nodes','score_raw','bestmove','pv','stop_reason']}})
        restore=json.loads((out/f'diagnose/{pos["id"]}/restore.json').read_text())
        assert restore['checked'] and restore['condition_sha256']==manifest['condition_sha256']
        for r in restore['searches'].values(): count(r); summary['control_searches']+=1
        summary['positions'].append(item)
    atomic(out/'summary.json',summary)
    with (out/'searches.csv').open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(summary['rows'][0]),lineterminator='\n')
        w.writeheader();w.writerows(summary['rows'])
    print(json.dumps({k:v for k,v in summary.items() if k not in ['positions','rows']},indent=2))
    for p in summary['positions']:
        print(json.dumps({k:p[k] for k in ['id','nodes','comparable_depth2','reduction','nonadditivity_nodes','root_order_diagnostic'] if k in p},indent=2))


if __name__=='__main__':
    main()
