"""Aggregate raw comparisons without interpreting nodes as independent trials."""
import json,csv,os
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V14_RESULTS',str(R/'results/v0.14')))
def read(p):return json.loads(p.read_text())
def ci(x):
 x=np.asarray(x,dtype=float);rng=np.random.default_rng(1414)
 if len(x)==0:return [None,None]
 vals=x[rng.integers(len(x),size=(5000,len(x)))].mean(1)
 return np.quantile(vals,[.025,.975]).tolist()
def quality(dirname):
 rows=[read(p) for p in sorted((D/dirname).glob('*.json'))];out={};table=[]
 budgets=sorted({str(r['budget']) for row in rows for r in row['runs']})
 for budget in budgets:
  for sample in ['allCp','normalCp']:
   data={};deltas={};decisions={}
   for row in rows:
    if not all(c['type']=='cp' for c in row['candidates']):continue
    if sample=='normalCp' and any(abs(c['score'])>=8000 for c in row['candidates']):continue
    scores={c['move']:c['score'] for c in row['candidates']};top=max(scores.values())
    runs={r['variant']:r for r in row['runs'] if str(r['budget'])==budget};base=runs['base'];bgap=top-scores[base['chosenMove']]
    for name,r in runs.items():
     gap=top-scores[r['chosenMove']];delta=gap-bgap
     data.setdefault(name,[]).append((gap,r['completed_depth'],r['nodes'],int(r['fallback']),r['elapsed_ms']))
     deltas.setdefault(name,[]).append(delta);decisions.setdefault(name,[]).append(int(r['chosenMove']!=base['chosenMove']))
     if sample=='allCp':table.append({'id':row['id'],'budget':budget,'variant':name,'gapCp':gap,'deltaGapCp':delta,'completedDepth':r['completed_depth'],'nodes':r['nodes'],'elapsedMs':r['elapsed_ms'],'move':r['chosenMove'],'fallback':r['fallback']})
   sub={}
   for name,values in data.items():
    a=np.asarray(values);ds=np.array(deltas[name]);sub[name]={'roots':len(a),'meanGapCp':float(a[:,0].mean()),'meanCompletedDepth':float(a[:,1].mean()),'meanNodes':float(a[:,2].mean()),'fallbacks':int(a[:,3].sum()),'meanMs':float(a[:,4].mean()),'meanDeltaGapCp':float(ds.mean()),'delta95CI':ci(ds),'improved':int((ds<0).sum()),'equal':int((ds==0).sum()),'worse':int((ds>0).sum()),'moveChanges':sum(decisions[name])}
   out[budget+' '+sample]=sub
 if table:
  with (D/(dirname+'-summary.csv')).open('w') as f:w=csv.DictWriter(f,fieldnames=list(table[0]));w.writeheader();w.writerows(table)
 return out
def fixed(dirname):
 rows=[read(p) for p in sorted((D/dirname).glob('*.json'))];group={};out={}
 for r in rows:group.setdefault((r['id'],r['analysis']['variant']),[]).append(r['analysis'])
 names=sorted({k[1] for k in group});ids=sorted({k[0] for k in group})
 for name in names:
  values=[];scorechange=0;movechange=0;complete=0
  for id in ids:
   rs=group.get((id,name));bs=group.get((id,'base'))
   if not rs or not bs:continue
   if any(not r['complete'] for r in rs+bs):continue
   a=rs[0];b=bs[0];values.append([a['nodes'],b['nodes'],np.median([r['elapsed_ms'] for r in rs]),np.median([r['elapsed_ms'] for r in bs])]);complete+=1
   scorechange+=int(a['score']!=b['score']);movechange+=int(a['bestmove']!=b['bestmove'])
   assert all((r['score'],r['nodes'],r['pv'])==(a['score'],a['nodes'],a['pv']) for r in rs)
  if not values:continue
  a=np.asarray(values);s=a.sum(0);rng=np.random.default_rng(1414);boot=a[rng.integers(len(a),size=(5000,len(a)))].sum(1);ratio=boot[:,2]/boot[:,3]
  out[name]={'completedRoots':complete,'nodeRatio':s[0]/s[1],'timeRatio':s[2]/s[3],'timeRatio95CI':np.quantile(ratio,[.025,.975]).tolist(),'scoreChanges':scorechange,'moveChanges':movechange}
 return out
def matches():
 groups={}
 for p in (D/'matches').glob('*.json'):
  g=read(p);name=g['pair'][0];result=g['result'];item=groups.setdefault(name,{'wins':0,'losses':0,'draws':0,'unresolved':0,'moves':0,'pairs':{}})
  item['moves']+=len(g['moves']);key='unresolved' if result.get('unresolved') else 'draws' if result['winner'] is None else 'wins' if result['winner']==g['candidateSide'] else 'losses'
  item[key]+=1
  # Unresolved is recorded independently; 0.5 scoring is explicitly provisional.
  item['pairs'].setdefault(g['root']['game'],[]).append(1 if key=='wins' else 0 if key=='losses' else .5)
 for name,x in groups.items():
  values=[np.mean(v) for v in x['pairs'].values()];x['starts']=len(values);x['scoreRateWithUnresolvedHalf']=float(np.mean(values));x['score95CI']=ci(values)
 return groups
def main():
 result={}
 for dirname in ['development','development-history','quality']:
  if (D/dirname).exists():result[dirname]=quality(dirname)
 for dirname in ['devfixed','devfixed-history','fixed']:
  if (D/dirname).exists():result[dirname]=fixed(dirname)
 if (D/'matches').exists():result['matches']=matches()
 (D/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
if __name__=='__main__':main()
