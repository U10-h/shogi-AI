#!/usr/bin/env python3
"""Frozen-test counterexamples only; never fed back to current model selection."""
import json,subprocess
import numpy as np
from prune_v13 import D,M,BIN,BASE,read,save,sigmoid
cases=[]
for p in sorted((D/'audit').glob('*efficient0025*.jsonl')):
 for line in p.open():
  row=json.loads(line)
  if row['event']=='audit' and row['improves']:cases.append({'file':p.name,**row})
w=np.array(read(D/'training.json')['weights']);cw=np.array(read(D/'cost-training.json')['weights'])
for c in cases:
 c['predicted_risk']=float(sigmoid(np.array(c['x'])@w));c['predicted_cost_probability']=float(sigmoid(np.array(c['x'])@cw));c['full_window_probes']=[]
 for depth in [0,1,2,3,4,6]:
  p=subprocess.run([str(BIN),'--sfen',c['sfen'],'--moves',c['move'],*BASE,'--depth','0','--qdepth',str(depth),'--max-nodes','2000000'],capture_output=True,text=True)
  assert p.returncode==0,p.stderr
  r=json.loads(p.stdout);c['full_window_probes'].append({'child_qdepth':depth,'parent_score':-r['score'],'parent_pv':[c['move'],*r['pv']],'nodes':r['nodes']})
 line=c['full_window_probes'][1]['parent_pv']
 p=subprocess.run([str(BIN),'--sfen',c['sfen'],'--moves',' '.join(line),*BASE,'--depth','0','--qdepth','1','--max-nodes','2000000'],capture_output=True,text=True)
 assert p.returncode==0,p.stderr
 r=json.loads(p.stdout);c['forced_shallow_capture_reply']={'line':line+r['pv'],'score_black_to_move':r['score'],'nodes':r['nodes']}
 c['limitations']='Standalone SFEN probes omit ancestor repetition history; same-depth threshold label is checked separately. Diagnostic only; no test-driven retuning.'
save(D/'counterexamples.json',cases);print(json.dumps(cases,indent=2))
