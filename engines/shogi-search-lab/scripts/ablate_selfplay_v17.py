#!/usr/bin/env python3
"""Fixed-penalty old-data-only control for new teacher-game contribution."""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.sparse import csr_matrix
R=Path(__file__).resolve().parents[1];D=R/'results/v0.17';M=R/'models/v0.17'
def dataset(split):
 d=np.load(D/f'policy-{split}.npz');ids=d['ids'];x=csr_matrix((np.ones(ids.size),(np.repeat(np.arange(len(ids)),10),ids.ravel())),shape=(len(ids),25392));return x,d['target'],d['ptr'],d['weights']
x,y,ptr,wg=dataset('train');wg=(wg==1).astype(float);g=np.repeat(np.arange(len(wg)),np.diff(ptr));starts=ptr[:-1];n=sum(wg)
def fg(w):
 s=x@w;mx=np.maximum.reduceat(s,starts);e=np.exp(s-mx[g]);sums=np.add.reduceat(e,starts);p=e/sums[g]
 return np.sum(wg[g]*y*(mx[g]+np.log(sums[g])-s))/n+.005*np.dot(w,w),x.T@(wg[g]*(p-y))/n+.01*w
o=minimize(fg,np.zeros(25392),method='L-BFGS-B',jac=True,options={'maxiter':100,'ftol':1e-9});w=np.rint(o.x*1024).astype(int)
(M/'old-data-all-policy.txt').write_text('shogi-lab-quiet-policy-v1 dim25392 scale1024\n'+' '.join(map(str,w))+'\n')
def metrics(w):
 x,y,ptr,_=dataset('test');s=x@w;ranks=[];ce=[]
 for a,b in zip(ptr[:-1],ptr[1:]):
  truth=int(np.argmax(y[a:b]));order=np.argsort(-s[a:b],kind='stable');ranks.append(int(np.where(order==truth)[0][0])+1);v=s[a:b]-max(s[a:b]);ce.append(float(-sum(y[a:b]*(v-np.log(sum(np.exp(v)))))))
 return {'positions':len(ranks),'teacherBestTop1':float(np.mean(np.array(ranks)==1)),'teacherBestTop5':float(np.mean(np.array(ranks)<=5)),'teacherBestMeanRank':float(np.mean(ranks)),'crossEntropy':float(np.mean(ce))}
result={'penalty':.01,'oldTrainingPositions':int(n),'iterations':int(o.nit),'test':metrics(w/1024),'mixedTest':json.loads((D/'policy-training.json').read_text())['test'],'interpretation':'Same all-move features and fixed L2=.01. Diagnostic ablation after main training; does not tune the frozen mixed model.'}
(D/'selfplay-ablation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
