import json, pathlib, statistics, random, collections, csv
D=pathlib.Path(__file__).resolve().parents[1]/'results/v0.20'
def read(p): return json.loads((D/p).read_text())
def mean(a): return statistics.mean(a) if a else None
out={'selection':read('selection.json')}
for stage in ['dev','test']:
 rows=[]
 for p in sorted((D/stage).glob('*.json')):
  x=json.loads(p.read_text()); teacher=D/(stage+'-teacher')/(x['root']['id']+'.json')
  if not teacher.exists(): continue
  cs=json.loads(teacher.read_text())['candidates']; cp=all(c['type']=='cp' and abs(c['score'])<30000 for c in cs)
  scores={c['move']:c['score'] for c in cs}; best=max(scores.values()) if cp else None
  for r in x['runs']:
   rows.append({'id':x['root']['id'],'game':x['root'].get('game'),'ms':x['ms'],'variant':r['variant'],'move':r['chosenMove'],'gap':best-scores[r['chosenMove']] if cp else None,'complete_iteration':r['has_result'],'depth':r['completed_depth'],'nodes':r['nodes'],'elapsed_ms':r['elapsed_ms'],'stop':r['stop_reason']})
 summary=[]
 for ms,name in sorted(set((r['ms'],r['variant']) for r in rows)):
  rr=[r for r in rows if r['ms']==ms and r['variant']==name]; gaps=[r['gap'] for r in rr if r['gap'] is not None]
  summary.append({'ms':ms,'variant':name,'n':len(rr),'cp_n':len(gaps),'mean_gap':mean(gaps),'median_gap':statistics.median(gaps) if gaps else None,'incomplete':sum(not r['complete_iteration'] for r in rr),'mean_depth':mean([r['depth'] for r in rr]),'mean_nodes':mean([r['nodes'] for r in rr])})
 out[stage]={'rows':rows,'summary':summary}
 if rows:
  with (D/(stage+'-summary.csv')).open('w') as f:
   w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
 if stage=='test' and rows:
  pairs=[]
  for ms,name in sorted(set((r['ms'],r['variant']) for r in rows if r['variant']!='base')):
   base={r['id']:r for r in rows if r['ms']==ms and r['variant']=='base' and r['gap'] is not None}
   rr=[r for r in rows if r['ms']==ms and r['variant']==name and r['gap'] is not None and r['id'] in base]
   deltas=[r['gap']-base[r['id']]['gap'] for r in rr]; groups=collections.defaultdict(list)
   for r,d in zip(rr,deltas):groups[r['game']].append(d)
   rng=random.Random(20260922);keys=list(groups);samples=[]
   if keys:
    for _ in range(20000):
     res=[d for k in rng.choices(keys,k=len(keys)) for d in groups[k]];samples.append(mean(res))
    samples.sort()
   pairs.append({'ms':ms,'variant':name,'n':len(rr),'clusters':len(keys),'delta_gap_vs_base':mean(deltas),'cluster_bootstrap_95':([samples[499],samples[19499]] if samples else None),'better_equal_worse':[sum(x<0 for x in deltas),sum(x==0 for x in deltas),sum(x>0 for x in deltas)]})
  out['test']['pairs']=pairs
for file in ['speed','speed-v19']:
 if not (D/(file+'.json')).exists():continue
 rows=read(file+'.json')['rows'];totals={}
 for name in sorted(set(r['variant'] for r in rows)):
  totals[name]=sum(statistics.median([r['ms'] for r in rows if r['variant']==name and r['id']==i]) for i in set(r['id'] for r in rows))
 out[file]={'sum_root_median_ms':totals,'runs':len(rows),'relative_to': 'v19' if file=='speed-v19' else 'base'}
 if file=='speed-v19':
  out[file]['cache_time_change_percent']=(totals['cache']/totals['v19']-1)*100
for file in ['spsa','spsa-200k']:
 x=read(file+'.json');out[file]={'complete':x['complete'],'nodes':x['protocol']['nodes'],'steps':len(x['steps']),'final':x['final'],'nonzero_differences':sum(r['difference']!=0 for r in x['steps']),'changed_pairs':sum(r['runs'][0]['move']!=r['runs'][1]['move'] for s in x['steps'] for r in s['rows'])}
if (D/'hard.json').exists():
 rows=read('hard.json')['rows'];out['hard']={n:{'complete':sum(r['analysis']['has_result'] for r in rows if r['analysis']['variant']==n),'n':sum(r['analysis']['variant']==n for r in rows)} for n in set(r['analysis']['variant'] for r in rows)}
if (D/'qsee-audit.json').exists():
 rows=read('qsee-audit.json')['rows'];out['qsee_audit']={n:{k:sum(r['analysis']['stats'].get(k,0) for r in rows if r['name']==n) for k in ['qsee_prunes','qsee_audits','qsee_missed_alpha','qsee_audit_nodes']} for n in set(r['name'] for r in rows)}
out['matches']=[]
for p in sorted((D/'matches').glob('*.json')):
 g=json.loads(p.read_text());out['matches'].append({'id':g['id'],'name':g['name'],'side':g['candidateSide'],'plies':len(g['moves']),'status':g['status'],'result':g['result'],'own_incomplete':sum(m['variant']!='yaneuraou' and not m['analysis']['has_result'] for m in g['moves'])})
(D/'summary.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps({k:({kk:vv for kk,vv in v.items() if kk!='rows'} if isinstance(v,dict) else v) for k,v in out.items()},ensure_ascii=False,indent=2))
