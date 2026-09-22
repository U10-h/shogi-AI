#!/usr/bin/env python3
import json,subprocess,os,hashlib
from pathlib import Path
import numpy as np
from ml_nnue import read_model,head_score,full_features
R=Path(__file__).resolve().parents[1];os.chdir(R)
A=Path(os.environ.get('YANEURAOU_ASSETS',R.parents[1]/'dist/vendor/yaneuraou'));B=R/'build/shogi-lab';D=R/'results/v0.16';D.mkdir(exist_ok=True,parents=True)
base=read_model(A/'yaneuraou.data');head=dict(np.load(R/'models/v0.12/pair100.npz',allow_pickle=False))
roots=json.loads((R/'results/v0.15/roots.json').read_text())
sfens=[r['sfen'] for r in roots]
for p in sorted((R/'results/v0.12/games').glob('*.json'))[:6]:
 sfens += [r['sfen'] for r in json.loads(p.read_text())['rows']][::4]
sfens=list(dict.fromkeys(sfens))[:256]
checks=0
for mode in ['nnue','nnue-blend25','nnue-clipped','nnue-tempo40']:
 cmd=[str(B),'--eval-batch','--eval',mode,'--eval-model',str(A/'yaneuraou.data')]
 if mode in ['nnue-blend25','nnue-clipped']:cmd+=['--eval-head',str(R/'models/v0.16/pair100-head.txt')]
 rows=[json.loads(s) for s in subprocess.check_output(cmd,input='\n'.join(sfens)+'\n',text=True).splitlines()]
 for s,r in zip(sfens,rows):
  h=full_features(s,base)[None,:];v=int(head_score(h,base)[0]);learn=int(head_score(h,head)[0]);delta=int((learn-v)/4)
  expected=v if mode=='nnue' else v+36 if mode=='nnue-tempo40' else v+max(-72,min(72,delta)) if mode=='nnue-clipped' else v+delta
  expected=max(-27000,min(27000,expected));assert expected==r['score'],(mode,s,expected,r['score']);checks+=1
same=0
flags='tt,history,killer,counter,mate-distance,qsearch,capture-history'
for r in roots[:8]:
 results=[]
 for b in [B,R/'build/shogi-lab-v0.15']:
  p=subprocess.run([str(b),'--advanced','--features',flags,'--eval','nnue','--eval-model',str(A/'yaneuraou.data'),'--moves',' '.join(r['prefix']),'--depth','16','--iterative','--max-nodes','20000'],text=True,capture_output=True)
  assert p.returncode in [0,3],p.stderr;results.append(json.loads(p.stdout))
 for k in ['score','bestmove','pv','nodes','completed_depth','stop_reason','fallback_pv']:
  assert results[0][k]==results[1][k],(k,results[0][k],results[1][k])
 same+=1
out={'independent_integer_checks':checks,'positions':len(sfens),'baseline_invariance_roots':same,'base_sha256':base['sha256'],'head_sha256':hashlib.sha256((R/'models/v0.16/pair100-head.txt').read_bytes()).hexdigest()}
(D/'verification.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
