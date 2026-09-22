"""Freeze roots without observing v0.11 model outcomes; audit old stop cases."""
import json,hashlib,subprocess,sys,platform
from pathlib import Path
import numpy as np
from ml_nnue import canonical
R=Path(__file__).resolve().parents[1];D=R/'results/v0.11'
def write(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
if sys.argv[1]=='roots':
 old={canonical(json.loads(s)['sfen']) for s in (R/'results/v0.10/labels.jsonl').read_text().splitlines()}
 roots=[];starts=[];excluded=0;games=[]
 for p in sorted((D/'games').glob('*.json')):
  g=json.loads(p.read_text());games.append(g['id']);rows=g['rows'];chosen=[]
  for offset in [15,31,47,63]:
   eligible=[r for r in rows if max(12,offset-7)<=r['offset']<=offset and not r['checked'] and all(c['type']=='cp' and abs(c['score'])<8000 for c in r['candidates'])]
   for r in reversed(eligible):
    key=canonical(r['sfen'])
    if key in old:excluded+=1;continue
    old.add(key);chosen.append({k:r[k] for k in ['game','offset','ply','prefix','sfen']});break
  if not chosen:raise ValueError('No novel root for game '+str(g['id']))
  roots+=chosen;starts.append(min(chosen,key=lambda r:abs(r['offset']-31)))
 assert games==list(range(16))
 write(D/'roots.json',roots);write(D/'starts.json',starts)
 values=[]
 for r in starts:
  g=json.loads((D/'games'/f'{r["game"]:02d}.json').read_text());row=next(x for x in g['rows'] if x['offset']==r['offset'])
  values.append({'game':r['game'],'ply':r['ply'],'teacherDepth6Score':row['candidates'][0]['score'],'sfen':r['sfen']})
 write(D/'start-balance.json',{'selection':'All prespecified16 starts; descriptive only','values':values,'absoluteCpPercentiles':np.percentile([abs(v['teacherDepth6Score']) for v in values],[0,25,50,75,100]).tolist()})
 write(D/'root-audit.json',{'games':len(games),'roots':len(roots),'starts':len(starts),'excludedExistingChecks':excluded,'noExactOrMirrorOverlapWithAllV010Labels':True,'selection':'Nearest eligible non-check cp-only position up to 7 plies before offsets 15/31/47/63; starts nearest offset31. No v0.11 outcome used.','rootsSha256':hashlib.sha256((D/'roots.json').read_bytes()).hexdigest()})
 print((D/'root-audit.json').read_text())
else:
 cases=[]
 for p in sorted((R/'results/v0.10/matches').glob('*.json')):
  g=json.loads(p.read_text());prefix=list(g['root']['prefix'])
  for m in g['moves']:
   if m['fallback']:cases.append({'oldMatch':p.name,'ply':m['ply'],'prefix':list(prefix),'variant':m['variant'],'oldMove':m['usi'],'oldAnalysis':m['analysis']})
   prefix.append(m['usi'])
 write(D/'fallback-cases.json',cases)
 checks=[]
 sample=json.loads((R/'results/v0.10/test-roots.json').read_text())[::4]
 for c in cases+[{**r,'variant':'base'} for r in sample]:
  args=['--moves',' '.join(c['prefix']),'--advanced','--preset','tactical','--eval','nnue','--eval-model',str(R.parent/'opponent/yaneuraou.data') if c['variant']=='base' else str(R/'build/models/v0.10/anchored50.nnue'),'--depth','16','--iterative','--max-nodes','12000']
  old=json.loads(subprocess.run([str(R/'build/shogi-lab-v0.10'),*args],capture_output=True,text=True,check=False).stdout)
  new=json.loads(subprocess.run([str(R/'build/shogi-lab'),*args],capture_output=True,text=True,check=False).stdout)
  fields=['score','pv','nodes','completed_depth','has_result','stop_reason','bestmove','stats']
  assert all(old.get(k)==new.get(k) for k in fields),[(k,old.get(k),new.get(k)) for k in fields if old.get(k)!=new.get(k)]
  checks.append({'prefix':c['prefix'],'variant':c['variant'],'has_result':new['has_result'],'fallback_source':new['fallback_source'],'identicalFields':fields})
 write(D/'search-invariance.json',{'checks':len(checks),'historicalFallbackCases':len(cases),'results':checks,'platform':platform.platform()})
 print('Matched old/new search on',len(checks),'positions;',len(cases),'historical fallback cases')
