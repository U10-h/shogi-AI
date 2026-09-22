#!/usr/bin/env python3
"""Distill teacher quiet-move preferences into a sparse additive ordering policy.

Train/validation split is by the previously fixed v0.10 game split. Positions
shared with train, including left-right reflection, are removed from validation.
Teacher candidates outside top 3 are unlabelled, not proven bad moves.
"""
import json, os, subprocess, hashlib
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.sparse import csr_matrix
from ml_nnue import canonical

R=Path(__file__).resolve().parents[1];D=R/'results/v0.14';M=R/'models/v0.14'
DIM=25392
def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def prepare():
    groups={'train':[],'validation':[]};seen=set();counts={}
    games=[json.loads(p.read_text()) for p in sorted((R/'results/v0.10/games').glob('*.json'))]
    for split in groups:
        counts[split]={'games':0,'duplicates':0,'positions':0,'moves':0}
        for g in games:
            if g['split']!=split:continue
            counts[split]['games']+=1
            for row in g['rows']:
                if row['checked'] or row['ply']<10:continue
                key=canonical(row['sfen'])
                if key in seen:counts[split]['duplicates']+=1;continue
                seen.add(key)
                if any(c['type']!='cp' or abs(c['score'])>=8000 for c in row['candidates']):continue
                groups[split].append({**row,'game':g['id']})
    flat=[r for rows in groups.values() for r in rows]
    proc=subprocess.run([str(R/'build/shogi-lab'),'--policy-dump'],input=''.join(r['sfen']+'\n' for r in flat),text=True,capture_output=True,check=True)
    all_dump=[json.loads(x) for x in proc.stdout.splitlines()];assert len(flat)==len(all_dump)
    offset=0;datasets={}
    for split,rows in groups.items():
        ids=[];targets=[];ptr=[0];meta=[]
        for r in rows:
            dump=all_dump[offset];offset+=1
            quiet=[x for x in dump['moves'] if x['quiet']]
            labels={c['pv'][0]:c['score'] for c in r['candidates'] if c['pv'][0] in {m['move'] for m in quiet}}
            if len(quiet)<2 or not labels:continue
            top=max(labels.values());y=np.array([np.exp((labels[m['move']]-top)/100) if m['move'] in labels else 0 for m in quiet]);y/=y.sum()
            ids.extend(m['ids'] for m in quiet);targets.extend(y);ptr.append(len(ids))
            meta.append({'game':r['game'],'sfen':r['sfen'],'teacher':labels,'moves':[m['move'] for m in quiet]})
        np.savez_compressed(D/f'policy-{split}.npz',ids=np.array(ids,dtype=np.int32),target=targets,ptr=ptr)
        save(D/f'policy-{split}-positions.json',meta)
        counts[split].update(positions=len(meta),moves=len(ids),labelledGames=len(set(x['game'] for x in meta)))
    save(D/'policy-data.json',counts)
    print(counts,flush=True)

def dataset(split):
    data=np.load(D/f'policy-{split}.npz');ids=data['ids'];n=len(ids)
    x=csr_matrix((np.ones(ids.size),(np.repeat(np.arange(n),10),ids.ravel())),shape=(n,DIM))
    return x,data['target'],data['ptr']
def metrics(w,data):
    x,y,ptr=data;score=x@w;starts=ptr[:-1];group=np.repeat(np.arange(len(starts)),np.diff(ptr))
    maximum=np.maximum.reduceat(score,starts);e=np.exp(score-maximum[group]);sums=np.add.reduceat(e,starts)
    loss=float(np.sum(y*(maximum[group]+np.log(sums[group])-score))/len(starts))
    hits=[];ranks=[]
    for a,b in zip(ptr[:-1],ptr[1:]):
        best=a+int(np.argmax(y[a:b]));order=np.argsort(-score[a:b],kind='stable');rank=int(np.flatnonzero(order==best-a)[0])+1
        hits.append(y[a+order[0]]>0);ranks.append(rank)
    return {'crossEntropy':loss,'topInTeacherQuietSet':float(np.mean(hits)),'teacherBestMeanRank':float(np.mean(ranks)),'teacherBestMRR':float(np.mean(1/np.array(ranks)))}
def train():
    tr=dataset('train');va=dataset('validation');x,y,ptr=tr;starts=ptr[:-1];n=len(starts);group=np.repeat(np.arange(n),np.diff(ptr))
    results=[];selected=None
    for penalty in [.001,.01,.1]:
        history=[]
        def fg(w):
            score=x@w;maximum=np.maximum.reduceat(score,starts);e=np.exp(score-maximum[group]);sums=np.add.reduceat(e,starts);p=e/sums[group]
            loss=np.sum(y*(maximum[group]+np.log(sums[group])-score))/n+.5*penalty*np.dot(w,w)
            grad=x.T@(p-y)/n+penalty*w
            return loss,grad
        opt=minimize(fg,np.zeros(DIM),method='L-BFGS-B',jac=True,options={'maxiter':140,'ftol':1e-10})
        w=np.rint(opt.x*1024).astype(int);path=M/f'quiet-policy-l2-{penalty}.txt'
        path.write_text('shogi-lab-quiet-policy-v1 dim25392 scale1024\n'+' '.join(map(str,w))+'\n')
        row={'penalty':penalty,'iterations':int(opt.nit),'converged':bool(opt.success),'train':metrics(w/1024,tr),'validation':metrics(w/1024,va),'path':str(path.relative_to(R)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        results.append(row);print(json.dumps(row),flush=True)
        if selected is None or row['validation']['crossEntropy']<selected['validation']['crossEntropy']:selected=row
    (M/'quiet-policy.txt').write_bytes((R/selected['path']).read_bytes())
    save(D/'policy-training.json',{'selected':selected,'trials':results,'zeroControl':metrics(np.zeros(DIM),va),'trainRows':n,'target':'soft teacher top-3 quiet candidates, temperature100cp, all other quiet moves have zero target mass, not a value estimate','scale':1024,'weights':DIM,'active':int(np.count_nonzero(np.fromstring((M/'quiet-policy.txt').read_text().splitlines()[1],sep=' ')))})

if __name__=='__main__':
    D.mkdir(exist_ok=True);M.mkdir(exist_ok=True)
    if not (D/'policy-train.npz').exists():prepare()
    train()
