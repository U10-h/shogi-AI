#!/usr/bin/env python3
"""Second validation-only iteration: rank loss, moment projection, affine control.

No v0.12 test model outcomes may exist when this script runs. A deterministic
affine projection after each epoch preserves the original training mean/std.
This blocks improvement by merely collapsing the score scale.
"""
import json,os,hashlib
from pathlib import Path
import numpy as np
from ml_nnue import *
from train_ml import forward
from train_pairs_v12 import ROOT,D,M,save,sha,metrics

def rank_gradient(x1,x2,sign,params,anchor_target,weights,qat=True):
    p1,(z1,h1,w,v)=forward(x1,params,qat);p2,(z2,h2,_,_)=forward(x2,params,qat)
    tau=.5;weights=weights/weights.sum();margin=sign*(p1-p2)/tau
    loss=np.sum(weights*np.logaddexp(0,-margin));g=-weights*sign/(tau*(1+np.exp(np.clip(margin,-60,60))))
    a1=p1-anchor_target[:,0];a2=p2-anchor_target[:,1];strength=.05
    loss+=strength*.25*np.sum(weights*(a1*a1+a2*a2))
    g1=g+strength*.5*weights*a1;g2=-g+strength*.5*weights*a2
    d1=g1[:,None]*v*(z1>0)*(z1<1);d2=g2[:,None]*v*(z2>0)*(z2<1)
    return float(loss),[d1.T@x1+d2.T@x2,(d1+d2).sum(0),h1.T@g1+h2.T@g2,np.array([g1.sum()+g2.sum()])]

def gradcheck():
    rng=np.random.default_rng(113);x=rng.random((7,32));y=rng.random((7,32))
    p=[rng.normal(0,.02,(32,32)),np.full(32,.4),rng.normal(0,.1,32),np.array([.1])]
    args=(x,y,np.array([1,1,-1,-1,1,-1,1]),p,rng.normal(0,.1,(7,2)),rng.random(7));g=rank_gradient(*args,qat=False)[1];errors=[]
    for k,idx in [(0,(3,4)),(1,(6,)),(2,(9,)),(3,(0,))]:
        old=p[k][idx];eps=1e-6;p[k][idx]=old+eps;hi=rank_gradient(*args,qat=False)[0]
        p[k][idx]=old-eps;lo=rank_gradient(*args,qat=False)[0];p[k][idx]=old;errors.append(abs((hi-lo)/(2*eps)-g[k][idx]))
    assert max(errors)<1e-7;return max(errors)

def main():
    assert not (D/'quality').exists() and not (D/'matches').exists(),'Validation amendment must precede test outcomes'
    assert not (D/'rank-protocol.json').exists()
    data=np.load(ROOT/'results/v0.10/dataset.npz');x0=data['x'];x=x0.astype(float)/127;base=data['base'];labels=json.loads((D/'pair-labels.json').read_text())
    pairs={k:np.array([p[k] for p in labels]) for k in ['i','j','gap','weight','game','offset','split']}
    train=(pairs['split']=='train')&(abs(pairs['gap'])>=18);val=pairs['split']=='validation';ids=np.flatnonzero(train)
    center=np.flatnonzero((data['split']=='train')&~data['checked']);original=read_model(Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data')
    prior=float_head(original);params=[v.copy() for v in prior];mom=[np.zeros_like(v) for v in params];var=[v.copy() for v in mom]
    # Control fits the gap model outputs on training data, not teacher test scores.
    gap=head_score(x0,dict(np.load(M/'pair100.npz')));scale=float(np.cov(base[center],gap[center],ddof=0)[0,1]/np.var(base[center]));inter=float(np.mean(gap[center])-scale*np.mean(base[center]))
    cp=[v.copy() for v in prior];cp[2]*=scale;cp[3]=cp[3]*scale+inter/SCALE;control=quantize(cp)
    for _ in range(2):control['b3']-=int(np.rint(np.mean(head_score(x0[center],control)-base[center])*16))
    write_head(M/'affine-gap.npz',control);export_model(original,control,ROOT/'build/models/v0.12/affine-gap.nnue')
    protocol={'reason':'Gap MAE fell but validation rank accuracy barely changed; prevent scale collapse before opening test outcomes',
              'seed':2026092212,'epochs':60,'learningRate':.00015,'batchSize':256,'loss':'pair logistic with sign labels; teacher separation >=20 cp',
              'parameterAnchor':.02,'valueAnchor':.05,'projection':'train quiet positions: float head mean and standard deviation matched to base after each epoch; output bias then centered after integer export',
              'selection':'highest validation rank agreement >=20cp, tie gapMAE; includes base; old test unused',
              'affineControl':{'fittedScale':scale,'fittedInterceptRaw':inter,'trainedOn':'v0.10 train quiet only'},'gradientMaxError':gradcheck()}
    save(D/'rank-protocol.json',protocol)
    baseline=metrics(base,pairs,val);best={'epoch':0,'validation':baseline,'head':{k:original[k].copy() for k in ['w2','b2','w3','b3']}}
    rng=np.random.default_rng(protocol['seed']);step=0;history=[]
    for epoch in range(1,61):
        order=rng.permutation(ids)
        for begin in range(0,len(order),256):
            k=order[begin:begin+256];i=pairs['i'][k];j=pairs['j'][k]
            _,grads=rank_gradient(x[i],x[j],np.sign(pairs['gap'][k]),params,np.column_stack([base[i],base[j]])/SCALE,pairs['weight'][k]);step+=1
            for layer in range(3):
                g=np.clip(grads[layer]+.02*(params[layer]-prior[layer]),-1,1)
                mom[layer]=.9*mom[layer]+.1*g;var[layer]=.999*var[layer]+.001*g*g
                params[layer]-=.00015*mom[layer]/(1-.9**step)/(np.sqrt(var[layer]/(1-.999**step))+1e-8)
            params[0]=np.clip(params[0],-2,127/64)
            params[2]=np.clip(params[2],-128*127/(16*SCALE),127*127/(16*SCALE))
        pred=forward(x[center],params,qat=False)[0]*SCALE
        factor=np.std(base[center])/np.std(pred);params[2]*=factor;params[3]=params[3]*factor+(np.mean(base[center])-factor*np.mean(pred))/SCALE
        params[2]=np.clip(params[2],-128*127/(16*SCALE),127*127/(16*SCALE))
        if epoch==1 or epoch%5==0:
            head=quantize(params)
            for _ in range(2):head['b3']-=int(np.rint(np.mean(head_score(x0[center],head)-base[center])*16))
            pp=head_score(x0,head);vm=metrics(pp,pairs,val)
            row={'epoch':epoch,'validation':vm,'meanCorrectionTrainCp':float(np.mean(pp[center]-base[center])/.9),'stdRatioTrain':float(np.std(pp[center])/np.std(base[center])),
                 'rmsCorrectionTrainCp':float(np.sqrt(np.mean((pp[center]-base[center]).astype(float)**2))/.9)}
            history.append(row);print(json.dumps(row),flush=True)
            score=(vm['rankAgreement20cp'],-vm['gapMaeCp']);old=(best['validation']['rankAgreement20cp'],-best['validation']['gapMaeCp'])
            if score>old:best={**row,'head':head}
    head=best.pop('head');write_head(M/'pair-rank.npz',head);modelsha=export_model(original,head,ROOT/'build/models/v0.12/pair-rank.nnue')
    result={'protocol':protocol,'baseline':baseline,'affineControlValidation':metrics(head_score(x0,control),pairs,val),'selected':best,'history':history,'modelSha256':modelsha,
            'frozenAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()}
    save(D/'rank-training.json',result);print(json.dumps({k:v for k,v in result.items() if k not in ['history','protocol']}),flush=True)

if __name__=='__main__':main()
