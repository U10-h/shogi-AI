"""Mechanism control: fixed-depth search without quiescence, no weight fitting."""
import json,subprocess,concurrent.futures,hashlib
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=R/'results/v0.11';roots=json.loads((D/'starts.json').read_text());rows=[]
def task(t):
 i,depth=t;root=roots[i];row={'game':root['game'],'depth':depth,'root':root,'runs':[]}
 for name in ['base','tempo40']:
  model=R.parent/'opponent/yaneuraou.data' if name=='base' else R/'build/models/v0.10/tempo40.nnue'
  p=subprocess.run([str(R/'build/shogi-lab'),'--moves',' '.join(root['prefix']),'--preset','baseline','--eval','nnue','--eval-model',str(model),'--depth',str(depth),'--max-nodes','3000000'],capture_output=True,text=True)
  assert p.returncode==0,p.stderr+p.stdout
  row['runs'].append({'variant':name,**json.loads(p.stdout)})
 return row
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
 rows=list(ex.map(task,[(i,d) for d in [1,2,3] for i in range(len(roots))]))
summary={}
for depth in [1,2,3]:
 rs=[r for r in rows if r['depth']==depth];ds=[r['runs'][1]['score']-r['runs'][0]['score'] for r in rs]
 summary[str(depth)]={'n':len(rs),'sameMove':sum(r['runs'][0]['bestmove']==r['runs'][1]['bestmove'] for r in rs),'samePv':sum(r['runs'][0]['pv']==r['runs'][1]['pv'] for r in rs),'rawScoreDifferences':ds,'scoreUnit':'pawn90_raw','allComplete':all(x['complete'] for r in rs for x in r['runs'])}
(D/'parity-control.json').write_text(json.dumps({'kind':'post-primary-mechanism-diagnostic','selection':'All16 prespecified starts, fixed depths1/2/3; no qsearch or weight tuning','binarySha256':hashlib.sha256((R/'build/shogi-lab').read_bytes()).hexdigest(),'summary':summary,'rows':rows},indent=2)+'\n')
print(json.dumps(summary,indent=2))
