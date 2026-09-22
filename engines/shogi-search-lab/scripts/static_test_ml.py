#!/usr/bin/env python3
"""Evaluate the frozen head on untouched non-check test labels; never tune."""
import hashlib,json
from pathlib import Path
import numpy as np
from ml_nnue import head_score
from train_ml import metrics
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.10'
frozen=json.loads((D/'frozen-model.json').read_text());path=ROOT/frozen['head']
assert hashlib.sha256(path.read_bytes()).hexdigest()==frozen['headSha256']
data=np.load(D/'dataset.npz',allow_pickle=False);head=dict(np.load(path,allow_pickle=False))
pred=head_score(data['x'],head);target=data['target'];base=data['base'];mask=(data['split']=='test')&~data['checked']
out={'frozenModelSha256':frozen['modelSha256'],'base':metrics(base,target,mask),'candidate':metrics(pred,target,mask),'byPly':{}}
for label,phase in [('0_39',data['ply']<40),('40_79',(data['ply']>=40)&(data['ply']<80)),('80_plus',data['ply']>=80)]:
    m=mask&phase;out['byPly'][label]={'n':int(m.sum()),'baseMAE':metrics(base,target,m)['maeCp'],'candidateMAE':metrics(pred,target,m)['maeCp']}
dest=D/'static-test.json'
if dest.exists():
    previous=json.loads(dest.read_text())
    for n in ['base','candidate']:
        for k in ['maeCp','rmseCp','p95AbsCp']:assert abs(previous[n][k]-out[n][k])<1e-9
else:dest.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
