#!/usr/bin/env python3
"""Development-driven improvement: prioritize branches with >=4 reference nodes."""
import json,math
import numpy as np
from prune_v13 import D,M,arrays,sigmoid,save,read
x,y,g,guard,cost=arrays('train');target=(cost>=4).astype(float)
w=np.zeros(x.shape[1]);w[0]=math.log(target.mean()/(1-target.mean()))
penalty=np.full(x.shape[1],.0001);penalty[0]=0
def objective(v):return float(np.mean(np.logaddexp(0,x@v)-target*(x@v))+.5*np.sum(penalty*v*v))
history=[]
for epoch in range(40):
 p=sigmoid(x@w);grad=x.T@(p-target)/len(y)+penalty*w;hess=(x.T*(p*(1-p)))@x/len(y)+np.diag(penalty+1e-9)
 step=np.linalg.solve(hess,grad);old=objective(w);rate=1.
 while objective(w-rate*step)>old and rate>1e-5:rate*=.5
 w-=rate*step;history.append({'epoch':epoch,'loss':objective(w)})
 if np.max(np.abs(rate*step))<1e-7:break
t=read(D/'training.json');riskw=np.array(t['weights']);low=np.array(t['domain_min']);high=np.array(t['domain_max'])
cx,cy,cg,cguard,ccost=arrays('calibration');risk=sigmoid(cx@riskw);expensive=sigmoid(cx@w)
domain=np.all((cx>=low-1e-9)&(cx<=high+1e-9),axis=1);table=[];selected=None
for rt in [.001,.0025,.005,.01,.02,.05]:
 for ct in [.02,.05,.1,.2,.4]:
  mask=cguard&domain&(risk<=rt)&(expensive>=ct);n=int(mask.sum());bad=int(cy[mask].sum());games=len(set(cg[mask].tolist()));benefit=int(np.maximum(ccost[mask]-1,0).sum())
  row={'risk_threshold':rt,'cost_threshold':ct,'n':n,'false_cuts':bad,'false_rate':bad/n if n else None,'games':games,'reference_nodes_minus_one':benefit};table.append(row)
  if n>=100 and games>=8 and bad/n<=.005 and (selected is None or benefit>selected['reference_nodes_minus_one']):selected=row
if selected is None:selected={'risk_threshold':0,'cost_threshold':.4,'decision':'disabled: no feasible calibration pair'}
(M/'alpha-risk-cost.txt').write_text('shogi-lab-alpha-risk-v2 nnue_raw90 qdepth6 dim17\n'+str(selected['risk_threshold'])+'\n'+'\n'.join(' '.join(format(v,'.17g') for v in row) for row in [riskw,low,high])+'\n'+str(selected['cost_threshold'])+'\n'+' '.join(format(v,'.17g') for v in w)+'\n')
save(D/'cost-training.json',{'trigger':'initial development: static verification zero errors but no node savings; guarded errors grew under changed tree distribution','target':'reference child cost >=4','selection':'maximum calibration sum(max(cost-1,0)) subject to false<=0.5%, >=100 candidates and >=8 games','train_costly_rate':float(target.mean()),'history':history,'grid':table,'selected':selected,'weights':w.tolist()});print(selected)
