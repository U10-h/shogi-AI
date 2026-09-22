#!/usr/bin/env python3
"""Time/node-bounded selective search with frozen evaluation hypotheses."""
import os,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1]
a=sys.argv[1:];name=a.pop(0) if a and not a[0].startswith('--') else 'adaptive'
names={'baseline':'nnue','history':'nnue','adaptive':'nnue','blend':'nnue-blend25','clipped':'nnue-clipped','tempo':'nnue-tempo40'}
if name not in names:raise SystemExit('Variant: '+','.join(names))
assets=Path(os.environ.get('YANEURAOU_ASSETS',R.parents[1]/'dist/vendor/yaneuraou'))
flags='tt,history,killer,counter,mate-distance,qsearch,capture-history'
if name=='history':flags+=',history-lmr'
cmd=[str(R/'build/shogi-lab'),'--usi' if '--usi' in a else '--advanced','--eval',names[name],'--eval-model',str(assets/'yaneuraou.data'),'--features',flags]
if name in ['blend','clipped']:cmd+=['--eval-head',str(R/'models/v0.16/pair100-head.txt')]
if name not in ['baseline','history']:cmd+=['--driver','adaptive']
else:cmd+=['--depth','16','--iterative']
if '--usi' not in a and '--time-ms' not in a and '--max-nodes' not in a:cmd+=['--time-ms','3000']
cmd+=['--max-nodes','1000000000']+[x for x in a if x!='--usi']
os.execv(cmd[0],cmd)
