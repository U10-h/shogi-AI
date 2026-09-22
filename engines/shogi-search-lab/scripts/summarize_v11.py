"""Aggregate prespecified controls with paired, trajectory-level bootstrap."""
import csv,json,collections,hashlib
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parents[1];D=R/'results/v0.11'
def read(p):return json.loads(p.read_text())
def write(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def boot(values,seed=2511):
 groups=collections.defaultdict(list)
 for key,v in values:groups[str(key)].append(float(v))
 a=np.array([[sum(v),len(v)] for v in groups.values()]);rng=np.random.default_rng(seed)
 if not len(a):return None
 inds=rng.integers(0,len(a),(5000,len(a)));res=a[inds].sum(axis=1);samples=res[:,0]/res[:,1]
 return {'mean':float(a[:,0].sum()/a[:,1].sum()),'ci95':np.percentile(samples,[2.5,97.5]).tolist(),'clusters':len(a),'n':int(a[:,1].sum()),'replicates':5000}
pairs=[('anchored50','base'),('tempo40','base'),('anchored50','tempo40')]
quality=[read(p) for p in sorted((D/'quality').glob('*.json'))]
match=[read(p) for p in sorted((D/'matches').glob('*.json'))]
fallback=[read(p) for p in sorted((D/'fallback').glob('*.json'))]
S={'qualityRows':len(quality),'matches':len(match),'fallbackCases':len(fallback),'quality':{},'matchComparisons':{},'fallback':{}}
qcsv=[]
for nodes in [12000,48000]:
 group=[r for r in quality if r['nodes']==nodes];stats={}
 for label,valid in [('allCp',lambda cs:all(c['type']=='cp' for c in cs)),('ordinaryCp',lambda cs:all(c['type']=='cp' and abs(c['score'])<8000 for c in cs))]:
  rows=[r for r in group if valid(r['candidates'])];out={'n':len(rows),'excluded':len(group)-len(rows),'variants':{},'comparisons':{}}
  for name in ['base','anchored50','tempo40']:
   runs=[next(x for x in r['runs'] if x['variant']==name) for r in group]
   gaps=[]
   for r in rows:
    run=next(x for x in r['runs'] if x['variant']==name);cs={c['move']:c['score'] for c in r['candidates']};gap=max(cs.values())-cs[run['chosenMove']];gaps.append((r['root']['game'],gap))
    if label=='allCp':qcsv.append({'id':r['id'],'game':r['root']['game'],'ply':r['root']['ply'],'nodes':nodes,'variant':name,'move':run['chosenMove'],'teacher_gap_cp':gap,'depth':run['completed_depth'],'fallback':run['fallback'],'ordinary_cp':all(abs(x)<8000 for x in cs.values())})
   out['variants'][name]={'gap':boot(gaps),'meanDepth':float(np.mean([r['completed_depth'] for r in runs])) if runs else None,'fallbacks':sum(r['fallback'] for r in runs),'partialFallbacks':sum(r['fallback_source']=='completed_root_child' for r in runs)}
  for a,b in pairs:
   diffs=[];same=0;examples=[]
   for r in rows:
    runs={x['variant']:x for x in r['runs']};cs={c['move']:c['score'] for c in r['candidates']};ma=runs[a]['chosenMove'];mb=runs[b]['chosenMove'];delta=cs[mb]-cs[ma];diffs.append((r['root']['game'],delta));same+=ma==mb
    examples.append({'row':r['id'],'game':r['root']['game'],'ply':r['root']['ply'],'deltaCp':delta,'candidateMove':ma,'controlMove':mb})
   out['comparisons'][a+'-'+b]={'deltaGap':boot(diffs),'improved':sum(v<0 for _,v in diffs),'equal':sum(v==0 for _,v in diffs),'worse':sum(v>0 for _,v in diffs),'sameMove':same,'largestChanges':sorted(examples,key=lambda x:abs(x['deltaCp']),reverse=True)[:5]}
  stats[label]=out
 S['quality'][str(nodes)]=stats
mcsv=[]
for level in ['short','long']:
 for a,b in pairs:
  games=[g for g in match if g['level']==level and g['pair']==[a,b]]
  if not games:continue
  w=l=d=u=0;values=[];fb=collections.Counter();partial=collections.Counter();plies=0;pv=0
  for g in games:
   result=g['result'];win=result['winner'];is_u=result.get('unresolved',False)
   if is_u:u+=1;outcome='unresolved'
   else:
    score=.5 if win is None else float(win==g['candidateSide']);values.append((g['root']['game'],score));w+=score==1;l+=score==0;d+=score==.5;outcome='draw' if score==.5 else 'win' if score==1 else 'loss'
   for m in g['moves']:
    fb[m['variant']]+=m['fallback'];partial[m['variant']]+=m['analysis']['fallback_source']=='completed_root_child';pv+=len(m['analysis']['pv'])+len(m['analysis']['fallback_pv'])
   plies+=len(g['moves']);mcsv.append({'id':g['id'],'level':level,'candidate':a,'control':b,'game':g['root']['game'],'side':g['candidateSide'],'outcome':outcome,'plies':len(g['moves']),'reason':result['reason']})
  S['matchComparisons'][level+'-'+a+'-'+b]={'games':len(games),'nodes':games[0]['nodes'],'wins':w,'losses':l,'draws':d,'unresolved':u,'resolvedScore':boot(values),'allGameScoreBounds':[(w+.5*d)/len(games),(w+.5*d+u)/len(games)],'fallbacks':dict(fb),'partialFallbacks':dict(partial),'plies':plies,'pvMovesVerified':pv}
for label,valid in [('allCp',lambda cs:all(c['type']=='cp' for c in cs)),('ordinaryCp',lambda cs:all(c['type']=='cp' and abs(c['score'])<8000 for c in cs))]:
 rs=[r for r in fallback if valid(r['candidates'])];diffs=[];oldg=[];newg=[];examples=[]
 for r in rs:
  cs={c['move']:c['score'] for c in r['candidates']};old=cs[r['legacyMove']];new=cs[r['run']['chosenMove']];cluster=r['oldMatch'].split('-')[0];diffs.append((cluster,old-new));oldg.append(max(cs.values())-old);newg.append(max(cs.values())-new);examples.append({'match':r['oldMatch'],'ply':r['ply'],'deltaCp':old-new,'old':r['legacyMove'],'new':r['run']['chosenMove'],'source':r['run']['fallback_source']})
 S['fallback'][label]={'n':len(rs),'excluded':len(fallback)-len(rs),'deltaGap':boot(diffs),'oldMeanGap':float(np.mean(oldg)) if rs else None,'newMeanGap':float(np.mean(newg)) if rs else None,'improved':sum(v<0 for _,v in diffs),'equal':sum(v==0 for _,v in diffs),'worse':sum(v>0 for _,v in diffs),'examples':sorted(examples,key=lambda x:abs(x['deltaCp']),reverse=True)}
S['fallback']['sources']=dict(collections.Counter(r['run']['fallback_source'] for r in fallback))
write(D/'summary.json',S)
for name,rows in [('quality-comparison.csv',qcsv),('match-comparison.csv',mcsv)]:
 if rows:
  with (D/name).open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
print(json.dumps({k:v for k,v in S.items() if k not in ['quality','fallback']},indent=2))
print('quality',json.dumps({n:{k:v['comparisons'] for k,v in x.items()} for n,x in S['quality'].items()},indent=2))
print('fallback',json.dumps({k:{a:b for a,b in v.items() if a!='examples'} if isinstance(v,dict) else v for k,v in S['fallback'].items()},indent=2))
