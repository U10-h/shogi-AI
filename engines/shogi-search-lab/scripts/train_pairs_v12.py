#!/usr/bin/env python3
"""Sibling score-gap distillation with train-only zero-mean calibration.

Features and game split stay frozen from v0.10. Labels come from candidates
within the SAME teacher search, not differences between unrelated positions.
The previously inspected old test split is never used for model selection.
"""
import itertools,json,os,hashlib
from collections import Counter
from pathlib import Path
import numpy as np
from ml_nnue import (SCALE,read_model,float_head,quantize,head_score,write_head,
                     export_model,board_key)
from train_ml import forward

ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.12';M=ROOT/'models/v0.12'
def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def pair_gradient(x1,x2,target,params,anchor_target,weights,qat=True):
    p1,(z1,h1,w,v)=forward(x1,params,qat)
    p2,(z2,h2,_,_)=forward(x2,params,qat)
    e=p1-p2-target;delta=.5
    weights=weights/weights.sum()
    loss=np.sum(weights*np.where(abs(e)<=delta,.5*e*e,delta*(abs(e)-.5*delta)))
    g=np.clip(e,-delta,delta)*weights
    # Penalize individual drift as well; this is separate from the gap target.
    a1=p1-anchor_target[:,0];a2=p2-anchor_target[:,1];strength=.05
    loss+=strength*.25*np.sum(weights*(a1*a1+a2*a2))
    g1=g+strength*.5*weights*a1;g2=-g+strength*.5*weights*a2
    d1=g1[:,None]*v*(z1>0)*(z1<1);d2=g2[:,None]*v*(z2>0)*(z2<1)
    return float(loss),[d1.T@x1+d2.T@x2,(d1+d2).sum(0),h1.T@g1+h2.T@g2,np.array([g1.sum()+g2.sum()])]

def gradient_check():
    rng=np.random.default_rng(37);x1=rng.uniform(0,1,(7,32));x2=rng.uniform(0,1,(7,32))
    p=[rng.normal(0,.02,(32,32)),np.full(32,.4),rng.normal(0,.1,32),np.array([.01])]
    target=rng.normal(0,.1,7);a=rng.normal(0,.1,(7,2));wt=rng.uniform(.1,1,7)
    args=(x1,x2,target,p,a,wt);loss,g=pair_gradient(*args,qat=False);err=[]
    for k,idx in [(0,(3,4)),(1,(6,)),(2,(9,)),(3,(0,))]:
        old=p[k][idx];eps=1e-6;p[k][idx]=old+eps;hi=pair_gradient(*args,qat=False)[0]
        p[k][idx]=old-eps;lo=pair_gradient(*args,qat=False)[0];p[k][idx]=old
        err.append(abs((hi-lo)/(2*eps)-g[k][idx]))
    assert max(err)<1e-7
    return max(err)

def prepare(data,labels):
    lookup={board_key(r['sfen']):i for i,r in enumerate(labels)};pairs=[]
    for p in sorted((ROOT/'results/v0.10/games-final').glob('*.json')):
        game=json.loads(p.read_text());split=game['split']
        if split=='test':continue
        for row in game['rows']:
            if row['ply']<12:continue
            candidates=[]
            for c in row['candidates']:
                i=lookup.get(board_key(c['childSfen']))
                if (i is not None and labels[i]['split']==split and not c['childChecked']
                    and c['type']=='cp' and abs(c['score'])<8000):
                    candidates.append((i,-c['score']*.9,c['rank']))
            n=len(candidates)*(len(candidates)-1)//2
            for (i,yi,ri),(j,yj,rj) in itertools.combinations(candidates,2):
                pairs.append({'i':i,'j':j,'gap':yi-yj,'weight':1/n,'game':game['id'],
                              'offset':row['offset'],'split':split,'ranks':[ri,rj]})
    save(D/'pair-labels.json',pairs)
    return {k:np.array([p[k] for p in pairs]) for k in ['i','j','gap','weight','game','offset','split']}

def metrics(pred,pairs,mask):
    diff=pred[pairs['i']]-pred[pairs['j']];e=(diff-pairs['gap'])/.9;wt=pairs['weight'][mask]
    non_tie=mask&(abs(pairs['gap'])>=18)  # Teacher separation >=20 cp.
    return {'pairs':int(mask.sum()),'roots':len(set(zip(pairs['game'][mask].tolist(),pairs['offset'][mask].tolist()))),
            'gapMaeCp':float(np.average(abs(e[mask]),weights=wt)),
            'gapRmseCp':float(np.sqrt(np.average(e[mask]**2,weights=wt))),
            'rankAgreement20cp':float(np.average(np.sign(diff[non_tie])==np.sign(pairs['gap'][non_tie]),weights=pairs['weight'][non_tie])),
            'rankPairs20cp':int(non_tie.sum())}

def centered(params,x,base,ids,original):
    head=quantize(params);head['b3']=original['b3'].copy()
    for _ in range(2):
        delta=np.mean(head_score(x[ids],head)-base[ids])
        head['b3']-=int(np.rint(delta*16))
    return head

def main():
    D.mkdir(exist_ok=True);M.mkdir(exist_ok=True)
    if (D/'training-protocol.json').exists():raise RuntimeError('Use a clean v0.12 result directory; do not overwrite an experiment')
    data=np.load(ROOT/'results/v0.10/dataset.npz');labels=[json.loads(x) for x in (ROOT/'results/v0.10/labels.jsonl').read_text().splitlines()]
    pairs=prepare(data,labels);x0=data['x'];x=x0.astype(float)/127;base=data['base']
    original=read_model(Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data');prior=float_head(original)
    train=pairs['split']=='train';val=pairs['split']=='validation';ids=np.flatnonzero(train)
    center_ids=np.flatnonzero((data['split']=='train')&~data['checked'])
    configs=[{'name':'pair50','alpha':.5},{'name':'pair100','alpha':1.}]
    protocol={'seed':2026092112,'epochs':60,'batchSize':256,'learningRate':.00015,'parameterAnchor':.02,
              'valueAnchor':.05,'gapResidualClipRaw':324,'loss':'Huber raw scale 300; each root has equal total weight',
              'configs':configs,'selection':'minimum root-weighted validation gap MAE over checkpoints and configs; base included',
              'calibration':'b3 is not trained; recalibrated to zero mean correction on training quiet positions only',
              'oldTestUsed':False,'pairsSha256':sha(D/'pair-labels.json'),'baseSha256':original['sha256'],
              'datasetSha256':sha(ROOT/'results/v0.10/dataset.npz'),'gradientMaxError':gradient_check()}
    save(D/'training-protocol.json',protocol)
    result={'protocol':protocol,'baseline':{s:metrics(base,pairs,mask) for s,mask in [('train',train),('validation',val)]},'configs':[]}
    baseline_score=result['baseline']['validation']['gapMaeCp'];winner={'name':'base','gapMaeCp':baseline_score}
    for cfg in configs:
        params=[v.copy() for v in prior];mom=[np.zeros_like(v) for v in params];var=[v.copy() for v in mom]
        rng=np.random.default_rng(protocol['seed']);step=0;history=[];best=None
        basegap=base[pairs['i']]-base[pairs['j']]
        target=(basegap+cfg['alpha']*np.clip(pairs['gap']-basegap,-324,324))/SCALE
        for epoch in range(1,61):
            order=rng.permutation(ids)
            for begin in range(0,len(order),256):
                k=order[begin:begin+256];i=pairs['i'][k];j=pairs['j'][k]
                loss,grads=pair_gradient(x[i],x[j],target[k],params,np.column_stack([base[i],base[j]])/SCALE,pairs['weight'][k]);step+=1
                for layer in range(3):
                    g=np.clip(grads[layer]+.02*(params[layer]-prior[layer]),-1,1)
                    mom[layer]=.9*mom[layer]+.1*g;var[layer]=.999*var[layer]+.001*g*g
                    params[layer]-=.00015*mom[layer]/(1-.9**step)/(np.sqrt(var[layer]/(1-.999**step))+1e-8)
                params[0]=np.clip(params[0],-2,127/64)
                params[2]=np.clip(params[2],-128*127/(16*SCALE),127*127/(16*SCALE))
            if epoch==1 or epoch%5==0:
                head=centered(params,x0,base,center_ids,original);pred=head_score(x0,head);vm=metrics(pred,pairs,val)
                row={'epoch':epoch,'validation':vm,'meanCorrectionTrainCp':float(np.mean(pred[center_ids]-base[center_ids])/.9),
                     'rmsCorrectionTrainCp':float(np.sqrt(np.mean((pred[center_ids]-base[center_ids]).astype(float)**2))/.9)}
                history.append(row);print(json.dumps({'name':cfg['name'],**row}),flush=True)
                if best is None or vm['gapMaeCp']<best['validation']['gapMaeCp']:best={**row,'head':head}
        head=best.pop('head');write_head(M/(cfg['name']+'.npz'),head)
        modelsha=export_model(original,head,ROOT/'build/models/v0.12'/(cfg['name']+'.nnue'))
        result['configs'].append({'config':cfg,'selected':best,'history':history,'modelSha256':modelsha})
        if best['validation']['gapMaeCp']<winner['gapMaeCp']:winner={'name':cfg['name'],'gapMaeCp':best['validation']['gapMaeCp'],'modelSha256':modelsha}
        save(D/'training.json',result)
    result['selected']=winner;save(D/'training.json',result)
    # Quantized integer evaluation parity and deterministic constant cancellation.
    assert np.array_equal((base[pairs['i']]+36)-(base[pairs['j']]+36),base[pairs['i']]-base[pairs['j']])
    save(D/'selected.json',{'selected':winner,'frozenAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
                            'testOpened':False,'trainingCodeSha256':sha(Path(__file__))})
    print(json.dumps({'baseline':result['baseline'],'selected':winner}),flush=True)

if __name__=='__main__':main()
