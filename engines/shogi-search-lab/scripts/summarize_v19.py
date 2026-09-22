#!/usr/bin/env python3
"""Summarize frozen v0.19 measurements without treating repeated roots as games."""
import csv,json,os,statistics
from collections import defaultdict
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V19_RESULTS',R/'results/v0.19'))
read=lambda p:json.loads(p.read_text())
mean=lambda a:statistics.mean(a) if a else None
def write_csv(name,rows):
 if not rows:return
 with (D/name).open('w') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
quality=[]
for p in sorted((D/'test').glob('*.json')):
 x=read(p);scores=read(D/'test-teacher'/f"{x['root']['id']}.json")['candidates']
 valid=all(c['type']=='cp' and abs(c['score'])<30000 for c in scores)
 score={c['move']:c['score'] for c in scores};best=max(score.values())
 for a in x['runs']:
  quality.append({'root':x['root']['id'],'game':x['root']['game'],'ms':x['ms'],'variant':a['variant'],'move':a['chosenMove'],'teacherGap':best-score[a['chosenMove']] if valid else None,'iteration':a['completed_depth'],'pvLength':len(a['pv'] if a['has_result'] else a['fallback_pv']),'selectiveDepth':a['stats']['selective_depth'],'nodes':a['nodes'],'elapsedMs':a['elapsed_ms'],'firstIterationFailure':not a['has_result'],'cacheHits':a['stats'].get('qtt_cutoffs',0),'cacheEntries':a['stats'].get('qtt_entries',0),'pathCapacityMisses':a['stats'].get('path_capacity_misses',0)})
write_csv('quality.csv',quality)
groups=defaultdict(list)
for r in quality:groups[r['variant'],r['ms']].append(r)
qs=[]
for (variant,ms),rs in sorted(groups.items()):
 qs.append({'variant':variant,'ms':ms,'roots':len(rs),'cpRoots':sum(r['teacherGap'] is not None for r in rs),'meanGap':mean([r['teacherGap'] for r in rs if r['teacherGap'] is not None]),'meanPV':mean([r['pvLength'] for r in rs]),'meanSelectiveDepth':mean([r['selectiveDepth'] for r in rs]),'meanIteration':mean([r['iteration'] for r in rs]),'meanNodes':mean([r['nodes'] for r in rs]),'firstIterationFailures':sum(r['firstIterationFailure'] for r in rs),'meanCacheHits':mean([r['cacheHits'] for r in rs]),'meanPathCapacityMisses':mean([r['pathCapacityMisses'] for r in rs])})
lookup={(r['root'],r['variant'],r['ms']):r for r in quality};roots=sorted({r['root'] for r in quality});names=sorted({r['variant'] for r in quality});comparisons=[]
for name in names:
 for a,b in [(1000,3000),(3000,5000)]:
  diffs=[lookup[k,name,b]['teacherGap']-lookup[k,name,a]['teacherGap'] for k in roots if lookup[k,name,a]['teacherGap'] is not None and lookup[k,name,b]['teacherGap'] is not None]
  comparisons.append({'variant':name,'fromMs':a,'toMs':b,'roots':len(diffs),'meanGapChange':mean(diffs),'better':sum(d<0 for d in diffs),'equal':sum(d==0 for d in diffs),'worse':sum(d>0 for d in diffs)})
paired=[]
selected=read(D/'selection.json')['selected']
for ms in [1000,3000,5000]:
 vals=[]
 for k in roots:
  a,b=lookup[k,'base',ms],lookup[k,selected,ms]
  if a['teacherGap'] is not None and b['teacherGap'] is not None:vals.append({'root':k,'game':a['game'],'delta':b['teacherGap']-a['teacherGap']})
 clusters=defaultdict(list)
 for v in vals:clusters[v['game']].append(v['delta'])
 paired.append({'ms':ms,'meanDelta':mean([v['delta'] for v in vals]),'better':sum(v['delta']<0 for v in vals),'equal':sum(v['delta']==0 for v in vals),'worse':sum(v['delta']>0 for v in vals),'trajectoryMeanDeltas':{k:mean(v) for k,v in clusters.items()}})
games=[];evaluations=[]
for p in sorted((D/'matches').glob('*.json')):
 g=read(p)
 if g['status']!='finished':raise RuntimeError('Unfinished match '+g['id'])
 own=[m for m in g['moves'] if m['variant']!='yaneuraou'];opponent=[m for m in g['moves'] if m['variant']=='yaneuraou'];risk=[]
 for m in opponent:
  info=m['analysis'].get('info')
  if info and info['type']=='cp' and not info['bound'] and abs(info['score'])<30000:
   risk.append((m['ply']-1,info['score']));evaluations.append({'game':g['id'],'ply':m['ply']-1,'ourCp':-info['score']})
 sustained=next((risk[i][0] for i in range(len(risk)-2) if all(cp>=500 for _,cp in risk[i:i+3])),None)
 winner=g['result']['winner'];outcome='unresolved' if g['result'].get('unresolved') else 'draw' if winner is None else 'win' if winner==g['candidateSide'] else 'loss'
 games.append({'id':g['id'],'variant':g['name'],'ourMs':g['ms'],'opponentMs':g['opponentMs'],'opening':'free','side':g['candidateSide'],'totalPlies':len(g['moves']),'outcome':outcome,'reason':g['result']['reason'],'firstSustained500Ply':sustained,'firstIterationFailures':sum(not m['analysis']['has_result'] for m in own),'meanOurSearchMs':mean([m['analysis']['elapsed_ms'] for m in own]),'meanOurWallMs':mean([m['wallMs'] for m in own]),'meanOpponentWallMs':mean([m['wallMs'] for m in opponent])})
write_csv('matches.csv',games);write_csv('opponent-evaluation.csv',evaluations)
mg=defaultdict(list)
for g in games:mg[g['variant'],g['ourMs']].append(g)
msum=[]
for (v,t),gs in sorted(mg.items()):
 msum.append({'variant':v,'ms':t,'games':len(gs),'wins':sum(g['outcome']=='win' for g in gs),'losses':sum(g['outcome']=='loss' for g in gs),'draws':sum(g['outcome']=='draw' for g in gs),'unresolved':sum(g['outcome']=='unresolved' for g in gs),'meanPlies':mean([g['totalPlies'] for g in gs]),'meanFirst500Ply':mean([g['firstSustained500Ply'] for g in gs if g['firstSustained500Ply'] is not None]),'firstIterationFailures':sum(g['firstIterationFailures'] for g in gs)})
fallback=[]
for name in ['root','legacy','all8','all32','entry1','entry8']:
 rs=[r['analysis'] for r in read(D/'fallback.json')['rows'] if r['analysis']['variant']==name]
 fallback.append({'variant':name,'completed':sum(r['has_result'] for r in rs),'roots':len(rs),'meanNodes':mean([r['nodes'] for r in rs])})
summary={'quality':qs,'pairedQuality':paired,'timeComparisons':comparisons,'games':games,'matches':msum,'fallback':fallback,'notes':['12 roots from four newly seeded teacher trajectories. Training overlap not fully ruled out.','One timing run per root/variant/budget; same pair rotates execution order.','No Elo or statistical strength claim. Four trajectory clusters too few for a stable generalization interval.','Total plies and sustained 500cp disadvantage are different observations; no certified defeat threshold.']}
(D/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False))
