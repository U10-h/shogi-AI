#!/usr/bin/env python3
"""Ridge distillation of teacher PV endpoint values; not MMTO or NNUE."""
import hashlib,json,subprocess
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'results/v0.7'
data=json.loads((OUT/'training-games.json').read_text())
assert data['status']=='finished'
rows=[]
for game in data['games']:
    for row in game['rows']:
        for c in row['candidates']:
            rows.append(dict(group=game['id'],split=game['split'],sfen=c['leafSfen'],target=c['blackScore']))
key=lambda s:' '.join(s.split()[:3])
# Eliminate exact board overlap across splits, keeping the later holdout intact.
test_keys={key(r['sfen']) for r in rows if r['split']=='test'}
test_keys|={key(r['sfen']) for g in data['games'] if g['split']=='test' for r in g['rows']}
val_keys={key(r['sfen']) for r in rows if r['split']=='validation'}
seen=set();kept=[]
for r in rows:
    k=key(r['sfen'])
    if r['split']=='train' and k in test_keys|val_keys:continue
    if r['split']=='validation' and k in test_keys:continue
    if (r['split'],k) in seen:continue
    seen.add((r['split'],k));kept.append(r)
out=subprocess.run([str(ROOT/'build/shogi-lab'),'--eval-batch','--eval','positional'],
    input='\n'.join(r['sfen'] for r in kept)+'\n',text=True,capture_output=True,check=True)
features=[json.loads(s) for s in out.stdout.splitlines()]
assert len(features)==len(kept)
x=np.array([f['features'] for f in features],float)
base=np.array([f['material']*(1 if r['sfen'].split()[1]=='b' else -1) for r,f in zip(kept,features)])
y=np.array([r['target'] for r in kept],float)
prior=np.array(features[0]['weights'],float)
indices={s:np.array([r['split']==s for r in kept]) for s in ['train','validation','test']}
scale=np.maximum(np.std(x[indices['train']],axis=0),1.0)
a=x[indices['train']]/scale
residual=y[indices['train']]-base[indices['train']]-x[indices['train']]@prior
def metrics(weights,split):
    m=indices[split];pred=base[m]+np.clip(x[m]@weights,-1500,1500)
    error=pred-y[m]
    return dict(n=int(m.sum()),mae=float(np.mean(abs(error))),rmse=float(np.sqrt(np.mean(error**2))))
candidates=[]
for strength in [10,100,1000]:
    w=prior+np.linalg.solve(a.T@a+strength*np.eye(x.shape[1]),a.T@residual)/scale
    w=np.clip(w,-500,500)
    candidates.append(dict(lambda_=strength,weights=w,validation=metrics(w,'validation')))
best=min(candidates,key=lambda r:r['validation']['mae'])
model=ROOT/'experiments/positional-v0.7.txt'
model.write_text('shogi-lab-positional-v1 38\n'+''.join(f'{name} {value:.10f}\n' for name,value in zip(features[0]['names'],best['weights'])))
controls={'material':np.zeros_like(prior),'positional':prior,'learned':best['weights']}
validation={name:metrics(w,'validation') for name,w in controls.items()}
# Choose among the two new evaluators using validation alone, before test metrics.
selected=min(['positional','learned'],key=lambda k:validation[k]['mae'])
freeze=dict(selected=selected,selection='Minimum validation PV-endpoint MAE among positional and learned; test unopened',
            lambda_=best['lambda_'],modelSha256=hashlib.sha256(model.read_bytes()).hexdigest(),validation=validation)
(OUT/'frozen-model.json').write_text(json.dumps(freeze,indent=2))
summary=dict(rawLabels=len(rows),retainedLabels=len(kept),features=len(prior),
    method='Teacher PV endpoint residual ridge around manual prior; fixed material; no intercept; positional correction clipped to ±1500',
    candidates=[{k:v for k,v in r.items() if k!='weights'} for r in candidates],
    freeze=freeze,metrics={s:{name:metrics(w,s) for name,w in controls.items()} for s in indices},
    weights=[dict(name=n,manual=float(p),learned=float(w)) for n,p,w in zip(features[0]['names'],prior,best['weights'])])
(OUT/'training-summary.json').write_text(json.dumps(summary,indent=2))
(OUT/'training-labels.json').write_text(json.dumps([dict(**r,material=float(b),features=f['features']) for r,b,f in zip(kept,base,features)],indent=2))
print(json.dumps({k:summary[k] for k in ['rawLabels','retainedLabels','freeze','metrics']},indent=2))
