#!/usr/bin/env python3
import json,os,subprocess,statistics,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BIN=ROOT/'build/shogi-lab';MODEL=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'
rows=json.loads((ROOT/'results/v0.7/comparison.json').read_text())['rows'][:8]
variants=[(e,eager) for e in ['nnue-full','nnue','positional'] for eager in [True,False]]
result={'protocol':'results/v0.8/protocol.json','binarySha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'modelSha256':hashlib.sha256(MODEL.read_bytes()).hexdigest(),'rows':[],'summary':{}}
for n,row in enumerate(rows):
 reference={}
 for rep in range(3):
  for j in range(len(variants)):
   mode,eager=variants[(n+rep+j)%len(variants)]
   args=[str(BIN),'--sfen',row['sfen'],'--advanced','--preset','tactical','--eval',mode,'--depth','3','--max-nodes','1000000000']
   if mode.startswith('nnue'):args+=['--eval-model',str(MODEL)]
   if eager:args+=['--eager-eval']
   p=subprocess.run(args,text=True,capture_output=True,check=True);r=json.loads(p.stdout)
   signature=[r[k] for k in ['score','bestmove','pv','nodes']];family='nnue' if mode.startswith('nnue') else mode
   if family in reference:assert signature==reference[family]
   reference[family]=signature
   result['rows'].append({'root':n,'repeat':rep,'mode':mode,'eager':eager,**r})
 for mode,eager in variants:
  key=mode+('-eager' if eager else '-lazy');samples=[r for r in result['rows'] if r['evaluation']==mode and r['eager']==eager]
  result['summary'][key]={'meanMs':statistics.mean(r['elapsed_ms'] for r in samples),'totalNodes':sum(r['nodes'] for r in samples),'totalMs':sum(r['elapsed_ms'] for r in samples)}
 (ROOT/'results/v0.8/speed.json').write_text(json.dumps(result,indent=2))
 print('root',n,flush=True)
print(json.dumps(result['summary'],indent=2))
