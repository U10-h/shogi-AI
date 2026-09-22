#!/usr/bin/env python3
import json,csv,statistics,math
from collections import defaultdict
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parents[1];D=R/'results/v0.17'
read=lambda p:json.loads(p.read_text())
def avg(v):return statistics.mean(v) if v else None
def csvwrite(path,rows):
 if not rows:return
 with path.open('w') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
quality=[];excluded=[]
for p in sorted((D/'test').glob('*.json')):
 row=read(p);path=D/'test-teacher'/f"{row['root']['id']}.json"
 if not path.exists():continue
 cs=read(path)['candidates'];valid=all(c['type']=='cp' and abs(c['score'])<30000 for c in cs)
 if not valid:excluded.append(row['root']['id'])
 scores={c['move']:c['score'] for c in cs};best=max(scores.values())
 for r in row['runs']:
  quality.append({'root':row['root']['id'],'game':row['root']['game'],'ms':row['ms'],'variant':r['variant'],'move':r['chosenMove'],'teacherGap':best-scores[r['chosenMove']] if valid else None,'completed':r['has_result'],'pvLength':len(r['pv'] if r['has_result'] else r['fallback_pv']),'seldepth':r['stats'].get('selective_depth',0),'iteration':r['completed_depth'],'nodes':r['nodes'],'elapsedMs':r['elapsed_ms'],'policyMoves':r['stats'].get('policy_moves_scored',0)})
csvwrite(D/'quality.csv',quality)
groups=defaultdict(list)
for r in quality:groups[(r['variant'],r['ms'])].append(r)
qsum=[]
for (name,ms),rows in sorted(groups.items()):
 qsum.append({'variant':name,'ms':ms,'roots':len(rows),'cpRoots':sum(r['teacherGap'] is not None for r in rows),'meanGap':avg([r['teacherGap'] for r in rows if r['teacherGap'] is not None]),'medianGap':statistics.median([r['teacherGap'] for r in rows if r['teacherGap'] is not None]),'meanPV':avg([r['pvLength'] for r in rows]),'meanSelectiveDepth':avg([r['seldepth'] for r in rows]),'firstIterationFailures':sum(not r['completed'] for r in rows),'meanNodes':avg([r['nodes'] for r in rows])})
comparisons=[]
lookup={(r['root'],r['variant'],r['ms']):r for r in quality};roots=sorted(set(r['root'] for r in quality))
for name in sorted(set(r['variant'] for r in quality)):
 for a,b in [(1000,3000),(3000,5000),(5000,10000)]:
  pairs=[(lookup[(i,name,a)],lookup[(i,name,b)]) for i in roots if (i,name,a) in lookup and (i,name,b) in lookup and lookup[(i,name,a)]['teacherGap'] is not None and lookup[(i,name,b)]['teacherGap'] is not None]
  differences=[y['teacherGap']-x['teacherGap'] for x,y in pairs]
  comparisons.append({'variant':name,'fromMs':a,'toMs':b,'roots':len(pairs),'meanGapChange':avg(differences),'better':sum(d<0 for d in differences),'equal':sum(d==0 for d in differences),'worse':sum(d>0 for d in differences)})
games=[];observations=[]
for p in sorted((D/'matches').glob('*.json')):
 g=read(p)
 if g['status']!='finished':continue
 own=[m for m in g['moves'] if m['variant']!='yaneuraou'];opponent=[m for m in g['moves'] if m['variant']=='yaneuraou'];risk=[]
 for m in opponent:
  info=m['analysis'].get('info')
  if info and info['type']=='cp' and abs(info['score'])<30000:
   risk.append((m['ply']-1,info['score']));observations.append({'game':g['id'],'ply':m['ply']-1,'ourCp':-info['score']})
 sustained=None
 for i in range(len(risk)-2):
  if all(cp>=500 for _,cp in risk[i:i+3]):sustained=risk[i][0];break
 winner=g['result']['winner'];outcome='unresolved' if g['result'].get('unresolved') else 'draw' if winner is None else 'win' if winner==g['candidateSide'] else 'loss'
 # Evaluate the same fixed early observation windows even when games terminate early.
 early=[cp for ply,cp in risk if ply<=40]
 games.append({'id':g['id'],'variant':g['name'],'ourMs':g['ms'],'opponentMs':g['opponentMs'],'opening':'free' if not g['opening'] else 'central-prefix','side':g['candidateSide'],'totalPlies':len(g['opening'])+len(g['moves']),'playedPlies':len(g['moves']),'outcome':outcome,'reason':g['result']['reason'],'firstSustained500Ply':sustained,'meanOurCpThrough40':-avg(early) if early else None,'firstIterationFailures':sum(not m['analysis']['has_result'] for m in own),'meanOurSearchMs':avg([m['analysis']['elapsed_ms'] for m in own]),'meanOurWallMs':avg([m['wallMs'] for m in own]),'meanOpponentWallMs':avg([m['wallMs'] for m in opponent]),'meanPV':avg([len(m['analysis']['pv'] if m['analysis']['has_result'] else m['analysis']['fallback_pv']) for m in own]),'worker':g['worker']})
csvwrite(D/'matches.csv',games);csvwrite(D/'opponent-evaluation.csv',observations)
mg=defaultdict(list)
for g in games:mg[(g['variant'],g['ourMs'],g['opening'])].append(g)
msum=[]
for (name,ms,opening),gs in sorted(mg.items()):
 msum.append({'variant':name,'ms':ms,'opening':opening,'games':len(gs),'wins':sum(g['outcome']=='win' for g in gs),'losses':sum(g['outcome']=='loss' for g in gs),'draws':sum(g['outcome']=='draw' for g in gs),'unresolved':sum(g['outcome']=='unresolved' for g in gs),'meanTotalPlies':avg([g['totalPlies'] for g in gs]),'meanPlayedPlies':avg([g['playedPlies'] for g in gs]),'meanFirst500Ply':avg([g['firstSustained500Ply'] for g in gs if g['firstSustained500Ply'] is not None]),'firstIterationFailures':sum(g['firstIterationFailures'] for g in gs)})
fallback=[]
for ms,path in [(1000,D/'fallback-replay.json'),(0,D/'long-fallback.json')]:
 if not path.exists():continue
 for row in read(path)['rows']:
  a=row['analysis'];fallback.append({'ply':row['ply'],'ms':ms or row['ms'],'name':a['variant'],'completed':a['has_result'],'pv':len(a['pv']),'seldepth':a['stats']['selective_depth']})
fg=defaultdict(list)
for r in fallback:fg[(r['name'],r['ms'])].append(r)
fsum=[{'variant':n,'ms':ms,'roots':len(rs),'completed':sum(r['completed'] for r in rs)} for (n,ms),rs in sorted(fg.items())]
result={'quality':qsum,'timeComparisons':comparisons,'excludedCpRoots':sorted(set(excluded)),'matches':msum,'games':games,'fallback':fsum,'notes':['Teacher common-candidate depth12 gap, not exact all-legal-move regret.','14 holdout roots from only 2 games; no independent 14-game sample or Elo claim.','Match mean hand counts use paired sides and only 2 opening prefixes.','500cp threshold is first of three consecutive recorded opponent evaluations, not certified defeat.','CPU-pinned matches run concurrently; quality is serial on a separate virtual core.']}
(D/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
