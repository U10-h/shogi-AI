#!/usr/bin/env python3
import json,csv,os
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V16_RESULTS',R/'results/v0.16'))
def read(p):return json.loads(p.read_text())
P=read(D/'protocol.json');rows=[]
for path in sorted((D/'quality').glob('*.json')):
 x=read(path);tp=D/'teacher'/f'{x["id"]}.json'
 if not tp.exists():continue
 cs=read(tp)['candidates'];scores={c['move']:c['score'] for c in cs if c['type']=='cp'};valid=len(scores)==len(cs) and all(abs(v)<=30000 for v in scores.values())
 for r in x['runs']:
  rows.append({'id':x['id'],'rep':x['rep'],'ms':x['ms'],'variant':r['variant'],'move':r['chosenMove'],'gap_cp':max(scores.values())-scores[r['chosenMove']] if valid else None,'raw_cp_gap':max(scores.values())-scores[r['chosenMove']] if len(scores)==len(cs) else None,
   'effort_or_depth':r['completed_depth'],'iteration_unit':r['iteration_unit'],'seldepth':r['stats'].get('selective_depth',0),'pv_plies':len(r['pv']),'nodes':r['nodes'],'elapsed_ms':r['elapsed_ms'],
   'fallback':not r['has_result'],'stop':r['stop_reason'],'reductions':r['stats'].get('adaptive_reductions',r['stats'].get('lmr_reductions',0)),
   'researches':r['stats'].get('adaptive_researches',r['stats'].get('lmr_researches',0)), 'max_legal_width':r['stats'].get('max_legal_width',0)})
if rows:
 with (D/'quality.csv').open('w')as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
summary=[];rng=np.random.default_rng(2026092216)
for ms in P['quality']['ms']:
 b={i:np.mean([r['gap_cp'] for r in rows if r['id']==i and r['variant']=='baseline' and r['ms']==ms and r['gap_cp'] is not None]) for i in range(P['roots']) if any(r['id']==i and r['variant']=='baseline' and r['ms']==ms and r['gap_cp'] is not None for r in rows)}
 for name in P['names']:
  rs=[r for r in rows if r['variant']==name and r['ms']==ms];gs=[r for r in rs if r['gap_cp'] is not None]
  if not rs:continue
  diffs=np.array([np.mean([r['gap_cp'] for r in gs if r['id']==i])-b[i] for i in range(P['roots']) if any(r['id']==i for r in gs)])
  boots=diffs[np.random.default_rng(2026092216+ms).integers(0,len(diffs),(5000,len(diffs)))].mean(axis=1) if len(diffs) else []
  summary.append({'ms':ms,'variant':name,'runs':len(rs),'cp_roots':len(diffs),'mean_gap':np.mean([r['gap_cp'] for r in gs]) if gs else None,'raw_all_cp_mean_gap':np.mean([r['raw_cp_gap'] for r in rs if r['raw_cp_gap'] is not None]),
   'paired_gap_difference':float(diffs.mean()) if len(diffs) else None,'paired_95_interval':np.quantile(boots,[.025,.975]).tolist() if len(boots) else None,
   'better_equal_worse':[int((diffs<0).sum()),int((diffs==0).sum()),int((diffs>0).sum())],
   **{f'mean_{k}':float(np.mean([r[k] for r in rs])) for k in ['seldepth','pv_plies','effort_or_depth','nodes','elapsed_ms','reductions','researches']},
   'fallbacks':sum(r['fallback'] for r in rs),'stop_reasons':{s:sum(r['stop']==s for r in rs) for s in sorted(set(r['stop'] for r in rs))}})
games=[]
for p in sorted((D/'matches').glob('*.json')) if (D/'matches').exists() else []:
 g=read(p)
 if g['status']!='finished':continue
 own=[m for m in g['moves'] if m['variant']==g['name']];a=[m['analysis'] for m in own]
 result='unresolved' if g['result'].get('unresolved') else 'draw' if g['result']['winner'] is None else 'win' if g['result']['winner']==g['candidateSide'] else 'loss'
 games.append({'id':g['id'],'variant':g['name'],'side':g['candidateSide'],'result':result,'reason':g['result']['reason'],'plies':len(g['opening'])+len(g['moves']),
  'mean_seldepth':float(np.mean([x['stats'].get('selective_depth',0)for x in a])),'mean_pv_plies':float(np.mean([len(x['pv'])for x in a])),
  'mean_own_search_ms':float(np.mean([x['elapsed_ms']for x in a])),'fallbacks':sum(not x['has_result']for x in a),
  'mean_opponent_search_ms':float(np.mean([m['analysis']['info']['time']for m in g['moves']if m['variant']=='yaneuraou' and m['analysis'].get('info')]))})
if games:
 with (D/'matches.csv').open('w')as f:w=csv.DictWriter(f,fieldnames=list(games[0]));w.writeheader();w.writerows(games)
match_summary=[]
for name in P['matches']['variants']:
 gs=[g for g in games if g['variant']==name]
 if gs:match_summary.append({'variant':name,'games':len(gs),**{k:sum(g['result']==k for g in gs)for k in ['win','loss','draw','unresolved']},'mean_plies':np.mean([g['plies']for g in gs])})
out={'quality':summary,'matches':match_summary,'games':games,'complete_quality':len(rows)==P['roots']*len(P['names'])*len(P['quality']['ms'])*P['quality']['repeats'], 'completed_games':len(games)}
(D/'summary.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(out,ensure_ascii=False,indent=2))
