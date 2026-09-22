#!/usr/bin/env python3
"""Paired root-level summaries, preserving mate cases and unresolved matches."""
import json,collections,pathlib,csv
import numpy as np
from prune_v13 import D,read,save
rng=np.random.default_rng(20261313)
protocol=read(D/'protocol.json');names=protocol['quality']['names'];roots=read(D/'roots.json')
out={'roots':len(roots),'protocol':protocol,'quality':{},'fixed':{},'audit':{},'matches':{}}
def ci_diff(a,b):
 a=np.array(a,float);b=np.array(b,float);delta=a-b;ids=rng.integers(len(a),size=(5000,len(a)))
 return {'mean_difference':float(delta.mean()),'ci95':np.quantile(delta[ids].mean(1),[.025,.975]).tolist(),'n':len(a)}
def ci_ratio(a,b):
 a=np.array(a,float);b=np.array(b,float);ids=rng.integers(len(a),size=(5000,len(a)))
 return {'ratio':float(a.sum()/b.sum()),'ci95':np.quantile(a[ids].sum(1)/b[ids].sum(1),[.025,.975]).tolist(),'n':len(a)}
quality=[read(p) for p in sorted((D/'quality').glob('*.json'))];assert len(quality)==len(roots)
out['quality_rows']=len(quality);out['quality_searches']=sum(len(r['runs']) for r in quality)
csvrows=[]
for budget in protocol['quality']['nodes']:
 group={'cp_roots':0,'mate_roots':[],'variants':{},'paired_vs_base':{}};gaps=collections.defaultdict(list)
 for row in quality:
  cs={c['move']:c for c in row['candidates']};rs={r['variant']:r for r in row['runs'] if r['budget']==budget}
  assert len(rs)==len(names)
  if not all(c['type']=='cp' for c in cs.values()):group['mate_roots'].append({'id':row['id'],'candidates':row['candidates']});continue
  best=max(c['score'] for c in cs.values());group['cp_roots']+=1
  for name,r in rs.items():
   gap=best-cs[r['chosenMove']]['score'];gaps[name].append(gap)
   csvrows.append({'root':row['id'],'game':row['root']['game'],'budget':budget,'variant':name,'move':r['chosenMove'],'gap_cp':gap,'depth':r['completed_depth']})
 for name in names:
  relevant=[r for row in quality for r in row['runs'] if r['budget']==budget and r['variant']==name]
  group['variants'][name]={'mean_gap_cp':float(np.mean(gaps[name])),'median_gap_cp':float(np.median(gaps[name])),
   'mean_depth':float(np.mean([r['completed_depth'] for r in relevant])),'fallbacks':sum(r['fallback'] for r in relevant),
   'different_moves_vs_base':sum(next(r for r in row['runs'] if r['budget']==budget and r['variant']==name)['chosenMove']!=next(r for r in row['runs'] if r['budget']==budget and r['variant']=='base')['chosenMove'] for row in quality)}
  group['paired_vs_base'][name]=ci_diff(gaps[name],gaps['base'])
 out['quality'][str(budget)]=group
with (D/'quality-summary.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(csvrows[0]));w.writeheader();w.writerows(csvrows)
fixed=collections.defaultdict(lambda:collections.defaultdict(list))
for p in sorted((D/'fixed').glob('*.json')):
 row=read(p);fixed[row['analysis']['variant']][row['id']].append(row['analysis'])
baseids=sorted(fixed['base']);assert len(baseids)==len(roots)
for name in names:
 rows=fixed[name];assert set(rows)==set(baseids) and all(len(v)==3 for v in rows.values())
 for rs in rows.values():
  for r in rs:assert r['complete']
  assert len({json.dumps([r['score'],r['pv'],r['nodes']]) for r in rs})==1,'Repeat nondeterminism'
 times=[float(np.median([r['elapsed_ms'] for r in rows[i]])) for i in baseids];bt=[float(np.median([r['elapsed_ms'] for r in fixed['base'][i]])) for i in baseids]
 nodes=[rows[i][0]['nodes'] for i in baseids];bn=[fixed['base'][i][0]['nodes'] for i in baseids]
 out['fixed'][name]={'roots':len(rows),'nodes':sum(nodes),'median_time_sum_ms':sum(times),'nodes_vs_base':ci_ratio(nodes,bn),'time_vs_base':ci_ratio(times,bt),
  'root_move_changes':sum(rows[i][0]['bestmove']!=fixed['base'][i][0]['bestmove'] for i in baseids),
  'root_score_changes':sum(rows[i][0]['score']!=fixed['base'][i][0]['score'] for i in baseids),
  'details':[{'id':i,'nodes':nodes[j],'time_ms':times[j],'base_time_ms':bt[j]} for j,i in enumerate(baseids)]}
audits=collections.defaultdict(list)
for p in (D/'audit').glob('*.json'):
 row=read(p);audits[row['analysis']['variant']].append((p,row))
for name,rows in audits.items():
 stats=collections.Counter();bad=[];complete=0
 for p,row in rows:
  a=row['analysis'];stats.update(a['stats']);complete+=a['complete'];observed=collections.Counter()
  normal=fixed[name][row['id']][0]
  assert a['complete'] and all(a[k]==normal[k] for k in ['score','pv','bestmove','completed_depth'])
  assert a['nodes']-normal['nodes']==a['stats'].get('learned_audit_nodes',0),'Audit changes non-audit work'
  for line in p.with_suffix('.jsonl').open():
   r=json.loads(line)
   if r['event']=='audit':
    observed['audits']+=1;observed['false']+=r['improves']
    if r['improves']:bad.append({'id':row['id'],'game':row['root']['game'],**r})
  assert observed['audits']==a['stats'].get('learned_audits',0)
  assert observed['false']==a['stats'].get('learned_false_prunes',0)
 count=stats['learned_audits'];false=stats['learned_false_prunes']
 out['audit'][name]={'roots':len(rows),'complete':complete,'prunes':count,'false_prunes':false,'false_rate':false/count if count else None,
  'reference_nodes':stats['learned_audit_nodes'],'verification_nodes':stats['learned_verification_nodes'],'worst_cases':sorted(bad,key=lambda r:r['parent_score_bound']-r['alpha'],reverse=True)[:5]}
matches=[read(p) for p in (D/'matches').glob('*.json')];assert len(matches)==32
for pair in protocol['matches']['pairs']:
 rows=[r for r in matches if r['pair']==pair];assert len(rows)==16
 wins=sum(r['result']['winner']==r['candidateSide'] for r in rows);losses=sum(r['result']['winner'] is not None and r['result']['winner']!=r['candidateSide'] for r in rows)
 unresolved=sum(r['result'].get('unresolved',False) for r in rows);draws=16-wins-losses-unresolved
 clusters=[]
 for game in sorted({r['root']['game'] for r in rows}):
  rs=[r for r in rows if r['root']['game']==game]
  clusters.append(sum(1 if r['result']['winner']==r['candidateSide'] else 0 if r['result']['winner'] else .5 for r in rs)/2)
 ids=rng.integers(8,size=(5000,8));interval=np.quantile(np.array(clusters)[ids].mean(1),[.025,.975]).tolist()
 out['matches']['-'.join(pair)]={'wins':wins,'losses':losses,'draws':draws,'unresolved':unresolved,'plies':sum(len(r['moves']) for r in rows),
  'score_rate':(wins+.5*draws)/16 if not unresolved else None,'paired_start_bootstrap_ci95':interval if not unresolved else None}
save(D/'summary.json',out)
print(json.dumps({'quality':{k:v['variants'] for k,v in out['quality'].items()},'fixed':{k:{j:v[j] for j in ['nodes','nodes_vs_base','time_vs_base','root_move_changes']} for k,v in out['fixed'].items()},'audit':{k:{j:v[j] for j in ['prunes','false_prunes','false_rate']} for k,v in out['audit'].items()},'matches':out['matches']},indent=2))
