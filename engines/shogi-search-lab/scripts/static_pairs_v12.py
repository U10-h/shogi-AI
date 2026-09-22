"""Post-freeze, new-trajectory sibling metrics with game-cluster uncertainty."""
import json,os,itertools,subprocess
from pathlib import Path
import numpy as np
from ml_nnue import canonical,head_score,read_model
from analyze_v12 import boot
R=Path(__file__).resolve().parents[1];D=R/'results/v0.12'
def read(p):return json.loads(p.read_text())
old={canonical(json.loads(l)['sfen']) for l in (R/'results/v0.10/labels.jsonl').read_text().splitlines()}
for p in (R/'results/v0.11/games').glob('*.json'):old.update(canonical(r['sfen']) for r in read(p)['rows'])
rows=read(D/'test-pair-children.json');sfens=[];lookup={};pairs=[];excluded=0
for r in rows:
    cs=[]
    for c in r['candidates']:
        if canonical(c['sfen']) in old:excluded+=1;continue
        if c['sfen'] not in lookup:lookup[c['sfen']]=len(sfens);sfens.append(c['sfen'])
        cs.append(c)
    count=len(cs)*(len(cs)-1)//2
    for a,b in itertools.combinations(cs,2):pairs.append({'i':lookup[a['sfen']],'j':lookup[b['sfen']],'gap':a['raw']-b['raw'],'weight':1/count,'game':r['game'],'offset':r['offset']})
basepath=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data';base=read_model(basepath)
r=subprocess.run([str(R/'build/shogi-lab'),'--eval-batch','--eval','nnue','--eval-model',str(basepath),'--nnue-features'],input='\n'.join(sfens)+'\n',capture_output=True,text=True,check=True)
features=[json.loads(l) for l in r.stdout.splitlines()];x=np.array([f['h1'] for f in features],dtype=np.uint8)
models={'base':base,'pair':dict(np.load(R/'models/v0.12/pair100.npz')),'affine':dict(np.load(R/'models/v0.12/affine-gap.npz')),'anchored50':dict(np.load(R/'models/v0.10/anchored50.npz')),'tempo40':dict(np.load(R/'models/v0.10/tempo40.npz'))}
pred={n:head_score(x,h) for n,h in models.items()};pred['zeroGapDiagnostic']=np.zeros(len(x),dtype=int)
arr={k:np.array([p[k] for p in pairs]) for k in pairs[0]};wt=arr['weight'];mask=abs(arr['gap'])>=18
out={'games':len(set(arr['game'])),'pairs':len(pairs),'roots':len(set(zip(arr['game'],arr['offset']))),'uniqueChildSfens':len(sfens),'overlapExcludedCandidates':excluded,'testUsedForSelection':False,'variants':{},'comparisons':{}}
pergame={}
for n,p in pred.items():
    gap=p[arr['i']]-p[arr['j']];err=abs(gap-arr['gap'])/.9;correct=(np.sign(gap)==np.sign(arr['gap'])).astype(float)
    out['variants'][n]={'gapMaeCp':float(np.average(err,weights=wt)),'rankAgreement20cp':float(np.average(correct[mask],weights=wt[mask]))}
    # Each root equally weighted for MAE; summarize within game before bootstrap.
    pergame[n]={g:{'mae':float(np.average(err[arr['game']==g],weights=wt[arr['game']==g])),
                  'rank':float(np.average(correct[(arr['game']==g)&mask],weights=wt[(arr['game']==g)&mask]))} for g in set(arr['game'])}
for a,b in [('pair','base'),('pair','affine'),('affine','base')]:
    out['comparisons'][a+'-'+b]={k:boot([(int(g),pergame[a][g][k]-pergame[b][g][k]) for g in pergame[a]]) for k in ['mae','rank']}
out['uncertainty']='Comparisons weight each game equally; point metrics weight each root equally. Ties in predicted rank count as nonagreement; teacher gaps <20cp excluded only from rank.'
(D/'static-test.json').write_text(json.dumps(out,indent=2)+'\n');(D/'static-test-pairs.json').write_text(json.dumps(pairs))
np.savez_compressed(D/'static-test-features.npz',x=x,**{n:v for n,v in pred.items()})
print(json.dumps(out,indent=2))
