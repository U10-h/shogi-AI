#!/usr/bin/env python3
"""Post-hoc measurement: observation-counter overhead, no model tuning."""
import json,subprocess,os,statistics
from pathlib import Path
R=Path(__file__).resolve().parents[1];A=Path(os.environ.get('YANEURAOU_ASSETS',R.parents[1]/'dist/vendor/yaneuraou'));D=R/'results/v0.16'
roots=json.loads((R/'results/v0.15/roots.json').read_text())[:8];rows=[]
for rep in range(2):
 for i,r in enumerate(roots):
  for name in (['old','observed']if(i+rep)%2==0 else ['observed','old']):
   b=R/('build/shogi-lab-v0.15'if name=='old'else'build/shogi-lab')
   args=[str(b),'--advanced','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history','--eval','nnue','--eval-model',str(A/'yaneuraou.data'),'--moves',' '.join(r['prefix']),'--depth','16','--iterative','--max-nodes','50000']
   p=subprocess.run(args,text=True,capture_output=True);assert p.returncode in [0,3],p.stderr
   rows.append({'id':i,'rep':rep,'variant':name,'analysis':json.loads(p.stdout)})
for i in range(8):
 for rep in range(2):
  a=[r['analysis']for r in rows if r['id']==i and r['rep']==rep]
  for k in ['score','bestmove','pv','nodes','completed_depth','stop_reason']:assert a[0][k]==a[1][k]
ms={name:sum(statistics.median([r['analysis']['elapsed_ms']for r in rows if r['id']==i and r['variant']==name])for i in range(8))for name in ['old','observed']}
out={'protocol':'post-hoc known v0.15 roots, 8 x 50k nodes x 2 variants x 2 repetitions, serial order rotation','observed_over_old_time_ratio':ms['observed']/ms['old'],'median_sums_ms':ms,'rows':rows}
(D/'counter-overhead.json').write_text(json.dumps(out)+'\n');print(json.dumps({k:v for k,v in out.items()if k!='rows'}))
