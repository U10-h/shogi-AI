#!/usr/bin/env python3
"""Exact search/inference parity for v0.15. Run after make and build_nnue_oracle.py."""
import json, os, subprocess, hashlib
from pathlib import Path

R=Path(__file__).resolve().parents[1]
D=R/'results/v0.15';D.mkdir(exist_ok=True)
MODEL=Path(os.environ.get('YANEURAOU_ASSETS',R.parent/'opponent'))/'yaneuraou.data'
FEATURES='tt,history,killer,counter,mate-distance,qsearch,capture-history'
def run(binary,args,stdin=None):
    p=subprocess.run([str(R/'build'/binary),*map(str,args)],input=stdin,text=True,capture_output=True)
    assert p.returncode in (0,3),(binary,p.returncode,p.stderr)
    return p.stdout
roots=json.loads((R/'results/v0.14/roots.json').read_text())
sfens=[]
for p in sorted((R/'results/v0.14/games').glob('*.json')):
    sfens.extend(x['sfen'] for x in json.loads(p.read_text())['rows'])
sfens.extend(['4k4/9/P8/9/9/9/9/9/4K4 b - 1',
 'k3r4/9/9/9/9/9/4G4/9/4K4 b P 1',
 '4k4/9/9/9/9/9/9/9/4K4 b 18P4L4N4S4G2B2R 1',
 '4k4/9/9/9/9/9/9/9/4K4 w 18p4l4n4s4g2b2r 1'])
sfens=list(dict.fromkeys(sfens));stdin='\n'.join(sfens)+'\n'
expected=list(map(int,run('nnue-oracle',[MODEL],stdin).splitlines()))
summary={'modelSha256':hashlib.sha256(MODEL.read_bytes()).hexdigest(),'staticPositions':len(sfens),'staticModes':{},'searchComparisons':0,'rows':[]}
for mode in ['nnue','nnue-scalar','nnue-full','nnue-verify']:
    got=[json.loads(s)['score'] for s in run('shogi-lab',['--eval-batch','--eval',mode,'--eval-model',MODEL],stdin).splitlines()]
    assert got==expected,(mode,'upstream inference mismatch')
    summary['staticModes'][mode]={'matches':len(got),'maxError':0}
keys=['score','bestmove','pv','nodes','leaves','terminals','cutoffs','skipped_siblings','completed_depth','stop_reason','has_result','fallback_move','fallback_pv','fallback_source','fallback_partial_score','completed_root_moves','candidates']
def equal(a,b):
    for k in keys:assert a[k]==b[k],(k,a[k],b[k])
    for key in ['stats','iterations']:
        aa=json.loads(json.dumps(a[key]));bb=json.loads(json.dumps(b[key]))
        if key=='stats':
            for x in [aa,bb]:
                x.pop('nnue_avx2_enabled',None);x.pop('nnue_verified',None)
        else:
            for x in aa+bb:x.pop('elapsed_ms',None)
        assert aa==bb,(key,aa,bb)
for i,root in enumerate(roots):
    args=['--advanced','--features',FEATURES,'--eval','nnue','--eval-model',MODEL,'--moves',' '.join(root['prefix']),'--depth',16,'--iterative','--max-nodes',100000]
    old=json.loads(run('shogi-lab-v0.14',args))
    for extra in [[],['--eager-order'],['--eval','nnue-scalar'],['--eval','nnue-verify']]:
        new=json.loads(run('shogi-lab',args+extra));equal(old,new);summary['searchComparisons']+=1
    summary['rows'].append({'id':i,'nodes':old['nodes'],'depth':old['completed_depth'],'pv':old['pv']})
    print('search parity',i,flush=True)
# Exact MultiPV top five and time/node abort restoration are also covered by selftests.
for root in roots[:3]:
    args=['--advanced','--features',FEATURES,'--eval','nnue','--eval-model',MODEL,'--moves',' '.join(root['prefix']),'--depth',2,'--multipv',5,'--max-nodes',1000000]
    equal(json.loads(run('shogi-lab-v0.14',args)),json.loads(run('shogi-lab',args)))
    summary['searchComparisons']+=1
summary['passed']=True
(D/'verification.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='rows'},indent=2))
