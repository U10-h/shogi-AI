#!/usr/bin/env python3
"""All-legal-move teacher distillation; game-disjoint validation and untouched test games."""
import json, subprocess, hashlib
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.sparse import csr_matrix
from ml_nnue import canonical
R=Path(__file__).resolve().parents[1];D=R/'results/v0.17';M=R/'models/v0.17';M.mkdir(exist_ok=True)
def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
old=[json.loads(p.read_text()) for p in sorted((R/'results/v0.10/games').glob('*.json'))]
new=[json.loads(p.read_text()) for p in sorted((D/'selfplay').glob('*.json'))]
groups={k:[] for k in ['train','validation','test']};seen=set();dropped={k:0 for k in groups}
for split in groups:
    for source,games in [('old',old),('new',new)]:
        for g in games:
            if g['split']!=split or source=='old' and split=='test':continue
            assert g['status']=='finished'
            for i,r in enumerate(g['rows']):
                if source=='old' and i%3:continue
                if any(c['type']!='cp' or abs(c['score'])>=8000 for c in r['candidates']):continue
                key=canonical(r['sfen'])
                if key in seen:dropped[split]+=1;continue
                seen.add(key)
                groups[split].append({**r,'source':source,'game':str(source)+'-'+str(g['id'])})
flat=[r for rows in groups.values() for r in rows]
proc=subprocess.run([str(R/'build/shogi-lab'),'--policy-dump'],input=''.join(r['sfen']+'\n' for r in flat),text=True,capture_output=True,check=True)
dumps=iter(json.loads(x) for x in proc.stdout.splitlines());datasets={};meta={}
for split,rows in groups.items():
    ids=[];targets=[];ptr=[0];meta[split]=[];weights=[]
    for r in rows:
        dump=next(dumps);moves=dump['moves'];labels={c['pv'][0]:c['score'] for c in r['candidates']}
        if len(moves)<2:continue
        assert set(labels)<=set(m['move'] for m in moves)
        top=max(labels.values());y=np.array([np.exp((labels[m['move']]-top)/100) if m['move'] in labels else 0 for m in moves]);y/=sum(y)
        ids.extend(m['ids'] for m in moves);targets.extend(y);ptr.append(len(ids));weights.append(3.0 if r['source']=='new' else 1.0)
        meta[split].append({k:r[k] for k in ['game','source','sfen','ply']}|{'moves':[m['move'] for m in moves],'labels':labels,'prefix':r.get('prefix')})
    ids=np.array(ids,dtype=np.int32);ptr=np.array(ptr);targets=np.array(targets);weights=np.array(weights)
    x=csr_matrix((np.ones(ids.size),(np.repeat(np.arange(len(ids)),10),ids.ravel())),shape=(len(ids),25392))
    datasets[split]=(x,targets,ptr,weights)
    np.savez_compressed(D/f'policy-{split}.npz',ids=ids,target=targets,ptr=ptr,weights=weights)
    save(D/f'policy-{split}-positions.json',meta[split])
def metrics(w,data):
    x,y,ptr,weight=data;s=x@w;ranks=[];top3=[];ce=[]
    for a,b in zip(ptr[:-1],ptr[1:]):
        truth=int(np.argmax(y[a:b]));order=np.argsort(-s[a:b],kind='stable');ranks.append(int(np.where(order==truth)[0][0])+1)
        top3.append(y[a+order[0]]>0);t=s[a:b]-max(s[a:b]);ce.append(float(-sum(y[a:b]*(t-np.log(sum(np.exp(t)))))))
    return {'positions':len(ranks),'teacherBestTop1':float(np.mean(np.array(ranks)==1)),'teacherBestTop5':float(np.mean(np.array(ranks)<=5)),'topInTeacherSet':float(np.mean(top3)),'teacherBestMeanRank':float(np.mean(ranks)),'crossEntropy':float(np.mean(ce))}
x,y,ptr,wg=datasets['train'];group=np.repeat(np.arange(len(wg)),np.diff(ptr));starts=ptr[:-1]
trials=[];selected=None
for penalty in [.01,.1]:
    def fg(w):
        score=x@w;maximum=np.maximum.reduceat(score,starts);e=np.exp(score-maximum[group]);sums=np.add.reduceat(e,starts);p=e/sums[group]
        loss=np.sum(wg[group]*y*(maximum[group]+np.log(sums[group])-score))/sum(wg)+.5*penalty*np.dot(w,w)
        grad=x.T@(wg[group]*(p-y))/sum(wg)+penalty*w
        return loss,grad
    opt=minimize(fg,np.zeros(25392),method='L-BFGS-B',jac=True,options={'maxiter':100,'ftol':1e-9})
    w=np.rint(opt.x*1024).astype(int);path=M/f'all-policy-l2-{penalty}.txt';path.write_text('shogi-lab-quiet-policy-v1 dim25392 scale1024\n'+' '.join(map(str,w))+'\n')
    row={'penalty':penalty,'iterations':int(opt.nit),'converged':bool(opt.success),'train':metrics(w/1024,datasets['train']),'validation':metrics(w/1024,datasets['validation']),'model':path.name}
    trials.append(row);print(json.dumps(row),flush=True)
    if selected is None or row['validation']['crossEntropy']<selected['validation']['crossEntropy']:selected=row
path=M/selected['model'];(M/'all-policy.txt').write_bytes(path.read_bytes());w=np.fromstring(path.read_text().splitlines()[1],sep=' ')/1024
oldw=np.fromstring((R/'models/v0.14/quiet-policy.txt').read_text().splitlines()[1],sep=' ')/1024
save(D/'policy-training.json',{'selected':selected,'trials':trials,'test':metrics(w,datasets['test']),'oldPolicyAllMoveDiagnostic':metrics(oldw,datasets['test']),'uniform':metrics(np.zeros(25392),datasets['test']),'counts':{k:{'positions':len(v),'new':sum(r['source']=='new' for r in v),'games':len(set(r['game'] for r in v))} for k,v in meta.items()},'duplicateDrops':dropped,'target':'teacher top-3 softmax100cp over all legal moves; non-top3 unlabelled values, zero imitation mass','newGameWeight':3,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
print(json.dumps(json.loads((D/'policy-training.json').read_text())['test']),flush=True)
