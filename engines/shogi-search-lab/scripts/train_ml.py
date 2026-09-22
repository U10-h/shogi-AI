#!/usr/bin/env python3
"""Train the nonlinear 32->32->1 NNUE head using explicit NumPy backprop.

The frozen feature transformer/first dense layer are pretrained. Validation
selects integer-export checkpoints. Test metrics are intentionally unopened.
"""
import argparse,hashlib,json,os
from pathlib import Path
import numpy as np
from ml_nnue import SCALE,read_model,float_head,quantize,head_score,write_head,export_model
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.10';M=ROOT/'models/v0.10'

def forward(x,params,qat=True):
    if qat:
        q=quantize(params);w,b,v,c=float_head(q)
    else:w,b,v,c=params
    z=x@w.T+b;h=np.clip(z,0,1)
    if qat:h=np.floor(h*127+1e-8)/127
    pred=h@v+c[0]
    return pred,(z,h,w,v)

def loss_grad(x,target,params,kind='mse',qat=True):
    pred,(z,h,w,v)=forward(x,params,qat);e=pred-target
    if kind=='huber':
        delta=.25;loss=np.mean(np.where(abs(e)<=delta,.5*e*e,delta*(abs(e)-.5*delta)));dy=np.clip(e,-delta,delta)/len(x)
    else:loss=np.mean(.5*e*e);dy=e/len(x)
    dh=(dy[:,None]*v)*(z>0)*(z<1)
    return float(loss),[dh.T@x,dh.sum(axis=0),h.T@dy,np.array([dy.sum()])]

def gradient_check():
    rng=np.random.default_rng(31);x=rng.uniform(0,1,(7,32));params=[rng.normal(0,.025,(32,32)),np.full(32,.4),rng.normal(0,.1,32),np.array([.07])];target=rng.normal(0,.1,7)
    _,grads=loss_grad(x,target,params,qat=False);errors=[]
    for layer,idx in [(0,(3,4)),(1,(5,)),(2,(7,)),(3,(0,))]:
        old=params[layer][idx];eps=1e-6;params[layer][idx]=old+eps;a=loss_grad(x,target,params,qat=False)[0];params[layer][idx]=old-eps;b=loss_grad(x,target,params,qat=False)[0];params[layer][idx]=old
        num=(a-b)/(2*eps);err=abs(num-grads[layer][idx]);errors.append(err);assert err<1e-7
    return max(errors)

def metrics(pred,target,mask):
    err=(pred[mask]-target[mask])/.9
    return {'n':int(mask.sum()),'maeCp':float(np.mean(abs(err))),'rmseCp':float(np.sqrt(np.mean(err**2))),'p95AbsCp':float(np.quantile(abs(err),.95))}

def main():
    p=argparse.ArgumentParser();p.add_argument('--stage',choices=['naive','rebuild'],required=True);a=p.parse_args()
    data=np.load(D/'dataset.npz',allow_pickle=False);x=data['x'].astype(np.float64)/127;y=data['target'];basepred=data['base'];split=data['split'];checked=data['checked']
    train=(split=='train')&~checked;val=(split=='validation')&~checked;ids=np.flatnonzero(train)
    original=read_model(Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data');prior=float_head(original)
    configs=[{'name':'naive','epochs':60,'lr':.0003,'alpha':1.,'residualClip':None,'anchor':0.,'loss':'mse'}] if a.stage=='naive' else [
        {'name':'anchored25','epochs':60,'lr':.00015,'alpha':.25,'residualClip':180.,'anchor':.02,'loss':'huber'},
        {'name':'anchored50','epochs':60,'lr':.00015,'alpha':.5,'residualClip':180.,'anchor':.02,'loss':'huber'}]
    result={'stage':a.stage,'gradientCheckMaxError':gradient_check(),'baselineValidation':metrics(basepred,y,val),'testMetricsOpened':False,'configs':[]}
    for cfg in configs:
        params=[v.copy() for v in prior];moment=[np.zeros_like(v) for v in params];variance=[np.zeros_like(v) for v in params];rng=np.random.default_rng(20260924);step=0;history=[];best=None
        residual=y-basepred
        if cfg['residualClip'] is not None:residual=np.clip(residual,-cfg['residualClip'],cfg['residualClip'])
        target=(basepred+cfg['alpha']*residual)/SCALE
        for epoch in range(1,cfg['epochs']+1):
            order=rng.permutation(ids);loss_sum=0
            for begin in range(0,len(order),256):
                batch=order[begin:begin+256];loss,grads=loss_grad(x[batch],target[batch],params,cfg['loss']);loss_sum+=loss*len(batch);step+=1
                for k in range(4):
                    g=grads[k]+cfg['anchor']*(params[k]-prior[k]);g=np.clip(g,-1,1)
                    moment[k]=.9*moment[k]+.1*g;variance[k]=.999*variance[k]+.001*g*g
                    params[k]-=cfg['lr']*(moment[k]/(1-.9**step))/(np.sqrt(variance[k]/(1-.999**step))+1e-8)
                params[0]=np.clip(params[0],-128/64,127/64)
                params[2]=np.clip(params[2],-128*127/(16*SCALE),127*127/(16*SCALE))
            if epoch%5==0 or epoch==1:
                head=quantize(params);pred=head_score(data['x'],head);vm=metrics(pred,y,val)
                row={'epoch':epoch,'trainingLoss':loss_sum/len(ids),'validation':vm,'changedParameters':int(sum(np.count_nonzero(head[k]!=original[k]) for k in head))};history.append(row)
                if best is None or vm['maeCp']<best['validation']['maeCp']:
                    best={**row,'head':head,'params':[v.copy() for v in params]}
                print(json.dumps({'name':cfg['name'],**row}),flush=True)
        name=cfg['name'];head=best.pop('head');params=best.pop('params');headpath=M/(name+'.npz');write_head(headpath,head)
        np.savez_compressed(M/(name+'-float.npz'),**{f'p{i}':v for i,v in enumerate(params)})
        modelpath=ROOT/'build/models/v0.10'/(name+'.nnue');sha=export_model(original,head,modelpath);pred=head_score(data['x'],head)
        diagnostics={label:metrics(pred,y,val&mask) for label,mask in {'ply_0_39':data['ply']<40,'ply_40_79':(data['ply']>=40)&(data['ply']<80),'ply_80_plus':data['ply']>=80,'base_error_le_100cp':abs(y-basepred)<=90,'base_error_gt_100cp':abs(y-basepred)>90}.items()}
        record={'config':cfg,'selected':best,'history':history,'head':str(headpath.relative_to(ROOT)),'modelSha256':sha,'validationDiagnostics':diagnostics,'deltaToBaseValidation':{'meanAbsCp':float(np.mean(abs(pred[val]-basepred[val]))/.9),'maxAbsCp':float(np.max(abs(pred[val]-basepred[val]))/.9)}}
        result['configs'].append(record)
        (D/('training-'+a.stage+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='configs'}),flush=True)

if __name__=='__main__':main()
