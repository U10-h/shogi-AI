#!/usr/bin/env python3
"""Freeze the rebuilt head using validation only, before opening test metrics."""
import datetime,hashlib,json,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.10'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
rows=[json.loads(p.read_text()) for p in sorted((D/'quality-rebuild').glob('*.json'))]
assert len(rows)==32 and all(r['status']=='finished' for r in rows)
def gaps(rows,n):return [next(x for x in r['runs'] if x['variant']==n)['teacherGapCp'] for r in rows]
selected=min(['anchored25','anchored50'],key=lambda n:statistics.mean(gaps(rows,n)))
control=[json.loads(p.read_text()) for p in sorted((D/'quality-biascontrol').glob('*.json'))]
assert len(control)==32 and all(r['status']=='finished' for r in control)
validation={n:{'meanGapCp':statistics.mean(gaps(control,n)),'fallbacks':sum(next(x for x in r['runs'] if x['variant']==n).get('fallback',False) for r in control)} for n in ['base',selected,'tempo40']}
assert validation[selected]['meanGapCp']<min(validation[n]['meanGapCp'] for n in ['base','tempo40'])
head=ROOT/'models/v0.10'/(selected+'.npz');model=ROOT/'build/models/v0.10'/(selected+'.nnue');dest=D/'frozen-model.json'
out={'selected':selected,'head':str(head.relative_to(ROOT)),'headSha256':sha(head),'modelSha256':sha(model),'binarySha256':sha(ROOT/'build/shogi-lab'),'frozenAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'validation':validation,'selection':'Lowest rebuilt-head validation candidate gap; also better than the +40cp bias control. Small validation evidence; test results do not participate.','testMetricsOpened':False,'testPlan':'96 roots x1000ms +24 roots x3000ms; 32 fixed12000-node games, 16 held-out starts x colors.'}
if dest.exists():
    old=json.loads(dest.read_text())
    for key in ['selected','headSha256','modelSha256','binarySha256','validation']:assert old[key]==out[key],key
    print(json.dumps({'status':'existing freeze verified','selected':selected}))
else:
    dest.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
