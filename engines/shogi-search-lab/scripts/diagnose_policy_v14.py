"""Post-hoc fixed-depth diagnosis; never used to refit or retune final models."""
import json,os,subprocess
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=R/'results/v0.14'
selection=json.loads((D/'diagnostic-selection.json').read_text());root=selection['root']
common=[str(R/'build/shogi-lab'),'--advanced','--preset','tactical','--eval','nnue','--eval-model',os.environ['YANEURAOU_ASSETS']+'/yaneuraou.data','--max-nodes','2000000']
rows=[]
for depth in [4,5]:
 for name in ['base','capture','policy1capture']:
  args=common+['--moves',' '.join(root['prefix']),'--depth',str(depth)]
  if name!='base':args+=['--features','tt,history,capture-history,killer,counter,mate-distance,qsearch']
  if name=='policy1capture':args+=['--policy-model',str(R/'models/v0.14/quiet-policy.txt')]
  p=subprocess.run(args,capture_output=True,text=True);assert p.returncode in [0,3],p.stderr
  r=json.loads(p.stdout);rows.append({'variant':name,'depth':depth,'analysis':r});print(name,depth,r['bestmove'],r['score'],r['nodes'],r['complete'],flush=True)
children=[]
for move in ['6a5b','3c2b','P*3d']:
 for depth in [3,4]:
  args=common+['--moves',' '.join(root['prefix']+[move]),'--depth',str(depth)]
  p=subprocess.run(args,capture_output=True,text=True);assert p.returncode in [0,3],p.stderr
  r=json.loads(p.stdout);children.append({'move':move,'childDepth':depth,'parentScore':-r['score'] if r['complete'] else None,'analysis':r});print(move,depth,children[-1]['parentScore'],r['nodes'],r['complete'],flush=True)
(D/'diagnosis.json').write_text(json.dumps({'selection':selection,'rootRuns':rows,'fullWindowChildren':children,'limitation':'Post-hoc one-root diagnosis. Warm history differs from original search. Finite qdepth is not a game-theoretic proof.'},indent=2)+'\n')
