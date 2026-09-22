#!/usr/bin/env python3
"""Frozen-evaluator alpha-risk training and reproducible development experiments."""
import argparse,concurrent.futures,hashlib,json,math,os,pathlib,subprocess,time
import numpy as np
from ml_nnue import canonical
ROOT=pathlib.Path(__file__).resolve().parents[1]
D=ROOT/'results/v0.13'; M=ROOT/'models/v0.13'; BIN=ROOT/'build/shogi-lab'
ASSETS=pathlib.Path(os.environ.get('YANEURAOU_ASSETS',ROOT.parent/'opponent'))
BASE=['--advanced','--preset','tactical','--eval','nnue','--eval-model',str(ASSETS/'yaneuraou.data')]
def save(p,x):
 p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x,ensure_ascii=False,indent=2))
def read(p):return json.loads(pathlib.Path(p).read_text())
def run(root,args,binary=BIN):
 p=subprocess.run([str(binary),'--moves',' '.join(root['prefix']),*BASE,*map(str,args)],capture_output=True,text=True,timeout=120)
 if p.returncode not in (0,3):raise RuntimeError(p.stderr)
 return json.loads(p.stdout)
def prepare():
 seen=set();roots=[]
 for split,ids in [('train',range(64)),('calibration',range(128,144)),('development',range(144,160))]:
  for game in ids:
   g=read(ROOT/f'results/v0.10/games-final/{game:03}.json');prefix=list(g['opening']);rows=[]
   for row in g['rows']:
    if not row['checked'] and row['ply']>=16 and row['candidates'][0]['type']=='cp' and abs(row['candidates'][0]['score'])<=2000:
     rows.append({**row,'prefix':list(prefix)})
    prefix.append(row['selected'])
   used=set()
   for target in [32,64]:
    choices=sorted(rows,key=lambda r:(abs(r['ply']-target),r['ply']))
    for r in choices:
     key=canonical(r['sfen'])
     if key in seen or r['ply'] in used:continue
     seen.add(key);used.add(r['ply']);roots.append({k:r[k] for k in ('sfen','prefix','ply')}|{'game':game,'split':split,'id':len(roots)});break
 save(D/'training-roots.json',roots)
 save(D/'training-protocol.json',{'seed':2026101313,'features':17,'train_games':[0,63],'calibration_games':[128,143],'development_games':[144,159],
  'root_targets':[32,64],'nodes':24000,'labels':'completed baseline child: 1 iff parent bound exceeds current alpha; null windows only',
  'calibration':'largest threshold with <=0.5% observed false cuts on guarded candidates, >=200 accepted from >=8 games; zero if none',
  'threshold_grid':[.001,.0025,.005,.01,.02,.05,.1], 'evaluation_sha256':hashlib.sha256((ASSETS/'yaneuraou.data').read_bytes()).hexdigest(),
  'claim':'grouped games; correlated q moves are not independent trials; threshold is empirical, no safety guarantee'})
 print('roots',len(roots))
def collect():
 roots=read(D/'training-roots.json');(D/'labels').mkdir(exist_ok=True)
 def one(r):
  p=D/f"labels/{r['id']:03}.json"
  if p.exists():return
  x=run(r,['--iterative','--depth',16,'--max-nodes',24000,'--prune-policy','collect','--prune-log',p.with_suffix('.jsonl'),'--trace-limit',1000000])
  normal=run(r,['--iterative','--depth',16,'--max-nodes',24000]) if r['id']%12==0 else None
  if normal:
   for key in ['score','pv','nodes','completed_depth','has_result','bestmove','fallback_move','stop_reason']:
    assert x[key]==normal[key],(r['id'],key)
  save(p,{'root':r,'analysis':x,'logging_parity':bool(normal)});print('collect',r['id'],x['stats'].get('learned_eligible',0),flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(one,roots))
def arrays(split):
 xs=[];ys=[];groups=[];guards=[];cost=[]
 for r in read(D/'training-roots.json'):
  if r['split']!=split:continue
  for line in (D/f"labels/{r['id']:03}.jsonl").open():
   row=json.loads(line);xs.append(row['x']);ys.append(row['improves']);groups.append(r['game']);guards.append(row['guarded']);cost.append(row['cost'])
 return np.array(xs),np.array(ys),np.array(groups),np.array(guards),np.array(cost)
def sigmoid(z):return 1/(1+np.exp(-np.clip(z,-35,35)))
def train():
 x,y,g,guard,cost=arrays('train');w=np.zeros(x.shape[1]);w[0]=math.log(y.mean()/(1-y.mean()));history=[]
 # Convex logistic fit by damped Newton; no class weighting (preserves frequency target).
 penalty=np.full(x.shape[1],.0001);penalty[0]=0
 def objective(v):return float(np.mean(np.logaddexp(0,x@v)-y*(x@v))+.5*np.sum(penalty*v*v))
 for epoch in range(40):
  p=sigmoid(x@w);grad=x.T@(p-y)/len(y)+penalty*w
  hess=(x.T*(p*(1-p)))@x/len(y)+np.diag(penalty+1e-9)
  step=np.linalg.solve(hess,grad);old=objective(w);rate=1.
  while objective(w-rate*step)>old and rate>1e-5:rate*=.5
  w-=rate*step;history.append({'epoch':epoch,'loss':objective(w),'max_step':float(np.max(np.abs(rate*step)))})
  if history[-1]['max_step']<1e-7:break
 low=x.min(0);high=x.max(0);cx,cy,cg,guard,ccost=arrays('calibration');p=sigmoid(cx@w)
 domain=np.all((cx>=low-1e-9)&(cx<=high+1e-9),axis=1);table=[];threshold=0
 for t in read(D/'training-protocol.json')['threshold_grid']:
  mask=guard&domain&(p<=t);n=int(mask.sum());bad=int(cy[mask].sum());games=len(set(cg[mask].tolist()))
  row={'threshold':t,'accepted':n,'false_cuts':bad,'false_rate':bad/n if n else None,'games':games,'reference_child_nodes':int(ccost[mask].sum())};table.append(row)
  if n>=200 and games>=8 and bad/n<=.005:threshold=t
 M.mkdir(exist_ok=True)
 (M/'alpha-risk.txt').write_text('shogi-lab-alpha-risk-v1 nnue_raw90 qdepth6 dim17\n'+str(threshold)+'\n'+'\n'.join(' '.join(format(v,'.17g') for v in row) for row in [w,low,high])+'\n')
 bins=[]
 for lo,hi in [(0,.001),(.001,.005),(.005,.01),(.01,.02),(.02,.05),(.05,.1),(.1,.3),(.3,1.00001)]:
  mask=(p>=lo)&(p<hi);bins.append({'range':[lo,hi],'n':int(mask.sum()),'predicted':float(p[mask].mean()) if mask.any() else None,'observed':float(cy[mask].mean()) if mask.any() else None})
 out={'train_samples':len(y),'train_games':len(set(g.tolist())),'train_positive_rate':float(y.mean()),'calibration_samples':len(cy),'calibration_positive_rate':float(cy.mean()),'calibration_brier':float(np.mean((p-cy)**2)),'constant_brier':float(np.mean((y.mean()-cy)**2)), 'history':history,'threshold':threshold,'calibration':table,'bins':bins,'weights':w.tolist(),'domain_min':low.tolist(),'domain_max':high.tolist()}
 save(D/'training.json',out);print(json.dumps(out,indent=2))
def policy(name):
 if name=='base':return []
 if name=='delta':return ['--features','tt,history,killer,counter,mate-distance,qsearch,delta']
 if name in ('efficient005','efficient0025'):
  return ['--prune-policy','efficient','--prune-model',M/'alpha-risk-cost.txt','--prune-probability',.005 if name=='efficient005' else .0025]
 args=['--prune-policy',name,'--prune-model',M/('alpha-risk-cost.txt' if name=='efficient' else 'alpha-risk.txt')]
 if name=='direct':args+=['--prune-probability',.05]
 return args
def development(improved=False):
 roots=[r for r in read(D/'training-roots.json') if r['split']=='development']
 names=['base','delta','direct','guarded','verified','efficient','staticcheck','efficient005','efficient0025'] if improved else ['base','delta','direct','guarded','staticcheck']
 def one(r):
  for n in names:
   p=D/f"{'development-improved' if improved else 'development'}/{r['id']:03}-{n}.json"
   if p.exists():continue
   extra=policy(n)
   if n not in ('base','delta'):extra+=['--prune-audit','--prune-log',p.with_suffix('.jsonl'),'--trace-limit',1000000]
   p.parent.mkdir(exist_ok=True)
   x=run(r,['--depth',3,'--max-nodes',2000000,*extra]);save(p,{'root':r,'variant':n,'analysis':x});print('dev',r['id'],n,x['nodes'],x['complete'],x['stats'].get('learned_false_prunes',0),x['stats'].get('learned_prunes',0),flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(one,roots))
def improve():development(True)
if __name__=='__main__':
 os.chdir(ROOT);a=argparse.ArgumentParser();a.add_argument('mode',choices=['prepare','collect','train','development','improve']);args=a.parse_args();globals()[args.mode]()
