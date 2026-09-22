"""Frozen head diagnostics on v0.10; descriptive only, no new selection."""
from pathlib import Path
import json
import numpy as np
from ml_nnue import head_score,read_model,full_features
R=Path(__file__).resolve().parents[1];D=R/'results/v0.11'
z=np.load(R/'results/v0.10/dataset.npz');base=read_model(R.parent/'opponent/yaneuraou.data');a=dict(np.load(R/'models/v0.10/anchored50.npz'));t=dict(np.load(R/'models/v0.10/tempo40.npz'))
p=head_score(z['x'],a)*100/90;b=z['base']*100/90;tempo=head_score(z['x'],t)*100/90;y=z['target']*100/90
rows={}
for split in ['train','validation','test']:
 m=(z['split']==split)&~z['checked'];delta=p[m]-b[m];residual=p[m]-tempo[m]
 rows[split]={'n':int(m.sum()),'meanCorrectionCp':float(delta.mean()),'sdCorrectionCp':float(delta.std()),'correctionPercentilesCp':np.percentile(delta,[0,5,25,50,75,95,100]).tolist(),'learnedMinusTempoMeanCp':float(residual.mean()),'learnedMinusTempoRmsCp':float(np.sqrt((residual**2).mean())),'baseMAE':float(abs(b[m]-y[m]).mean()),'learnedMAE':float(abs(p[m]-y[m]).mean()),'tempoMAE':float(abs(tempo[m]-y[m]).mean()),'fractionCorrectionEnergyExplainedByConstant40':float(1-np.sum(residual**2)/np.sum(delta**2))}
# Check exported frozen heads directly against C++ on the new roots.
import subprocess
roots=json.loads((D/'roots.json').read_text());verified=0
for root in roots:
 x=full_features(root['sfen'],base)[None,:]
 for name,head in [('base',base),('anchored50',a),('tempo40',t)]:
  model=R.parent/'opponent/yaneuraou.data' if name=='base' else R/f'build/models/v0.10/{name}.nnue'
  result=subprocess.run([str(R/'build/shogi-lab'),'--eval','nnue','--eval-model',str(model),'--eval-batch'],input=root['sfen']+'\n',capture_output=True,text=True)
  if result.returncode:raise RuntimeError(result.stderr)
  v=json.loads(result.stdout)
  actual=v.get('score',v.get('evaluation'))
  if actual is None:raise ValueError(v)
  expected=int(head_score(x,head)[0]);assert actual==expected,(name,actual,expected,v)
  verified+=1
(D/'head-diagnostics.json').write_text(json.dumps({'priorDataOnly':True,'noModelSelection':True,'splits':rows,'independentPythonCppNewRootChecks':verified},indent=2)+'\n')
print(json.dumps(rows,indent=2));print('Verified',verified)
