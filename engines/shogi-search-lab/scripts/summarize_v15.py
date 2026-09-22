#!/usr/bin/env python3
"""Paired, root-level summaries. Repeats are not independent positions."""
import csv,json,statistics,random,os
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V15_RESULTS',R/'results/v0.15'))
read=lambda p:json.loads(p.read_text())
protocol=read(D/'protocol.json');names=protocol['names'];n=protocol['roots']
def ci(xs,ys=None,ratio=False):
    rng=random.Random(2026092215);out=[]
    for _ in range(5000):
        ids=[rng.randrange(len(xs)) for _ in xs]
        a=sum(xs[i] for i in ids)
        out.append(a/sum(ys[i] for i in ids) if ratio else a/len(ids))
    out.sort();return [out[125],out[4874]]
summary={'fixed':{},'quality':{},'protocol':protocol,'limitations':['Historical depth12 teacher is an estimate, not a full minimax oracle.','Same opening families. Two time repeats do not increase the independent root count.','CPU timing excludes model loading and process startup.','No match-based strength/Elo claim.']}
dev={}
for p in (D/'dev').glob('*.json'):
    r=read(p)['analysis'];dev.setdefault(r['variant'],[]).append(r)
if dev:
    summary['development']={name:{'roots':len(rr),'sumMs':sum(r['elapsed_ms'] for r in rr),
      'timeRatio':sum(r['elapsed_ms'] for r in rr)/sum(r['elapsed_ms'] for r in dev['baseline']),
      'meanDepth':statistics.mean(r['completed_depth'] for r in rr)} for name,rr in dev.items()}
fixed=[];times={};nodes={}
for name in names:
    times[name]=[];nodes[name]=[]
    for i in range(n):
        rr=[read(D/'fixed'/f'{i}-{name}-{rep}.json')['analysis'] for rep in range(protocol['fixed']['repeats'])]
        assert all(r['complete'] for r in rr),(name,i,'incomplete fixed depth')
        assert len({json.dumps([r[k] for k in ['score','pv','nodes','completed_depth']]) for r in rr})==1
        times[name].append(statistics.median(r['elapsed_ms'] for r in rr));nodes[name].append(rr[0]['nodes'])
        for rep,r in enumerate(rr):fixed.append({'id':i,'variant':name,'repeat':rep,'ms':r['elapsed_ms'],'nodes':r['nodes'],'score':r['score'],'bestmove':r['bestmove'],'depth':r['completed_depth']})
    base=[read(D/'fixed'/f'{i}-baseline-0.json')['analysis'] for i in range(n)]
    new=[read(D/'fixed'/f'{i}-{name}-0.json')['analysis'] for i in range(n)]
    summary['fixed'][name]={'positions':n,'medianMsSum':sum(times[name]),'timeRatio':sum(times[name])/sum(times['baseline']),
      'timeRatio95':ci(times[name],times['baseline'],True),'nodeRatio':sum(nodes[name])/sum(nodes['baseline']),
      'scoreChanges':sum(a['score']!=b['score'] for a,b in zip(base,new)),
      'moveChanges':sum(a['bestmove']!=b['bestmove'] for a,b in zip(base,new)),
      'pvChanges':sum(a['pv']!=b['pv'] for a,b in zip(base,new))}
assert summary['fixed']['fast']['nodeRatio']==1 and all(summary['fixed']['fast'][k]==0 for k in ['scoreChanges','moveChanges','pvChanges'])
quality=[]
for ms in protocol['quality']['ms']:
    grouped={name:[] for name in names}
    for i in range(n):
        candidates=read(D/'teacher'/f'{i}.json')['candidates'];cp=all(c['type']=='cp' for c in candidates)
        scores={c['move']:c['score'] for c in candidates};best=max(scores.values()) if cp else None
        rows={name:[] for name in names}
        for rep in range(protocol['quality']['repeats']):
            runs=read(D/'quality'/f'{i}-{ms}-{rep}.json')['runs'];base=next(r for r in runs if r['variant']=='baseline')
            for r in runs:
                row={'id':i,'repeat':rep,'budgetMs':ms,'variant':r['variant'],'elapsedMs':r['elapsed_ms'],'nodes':r['nodes'],'depth':r['completed_depth'],'move':r['chosenMove'],
                  'gapCp':best-scores[r['chosenMove']] if cp else None,'deltaGapCp':scores[base['chosenMove']]-scores[r['chosenMove']] if cp else None,
                  'changed':r['chosenMove']!=base['chosenMove'],'pvLength':len(r['pv']),'lmrReductions':r['stats'].get('lmr_reductions',0),'lmrResearches':r['stats'].get('lmr_researches',0)}
                rows[r['variant']].append(row);quality.append(row)
        for name in names:
            rr=rows[name];grouped[name].append({k:statistics.mean(r[k] for r in rr) if rr[0][k] is not None else None for k in ['nodes','depth','gapCp','deltaGapCp','elapsedMs','changed','pvLength']})
    summary['quality'][str(ms)]={}
    for name,rr in grouped.items():
        eligible=[r for r in rr if r['gapCp'] is not None];deltas=[r['deltaGapCp'] for r in eligible]
        summary['quality'][str(ms)][name]={'positions':n,'cpPositions':len(eligible),'meanDepth':statistics.mean(r['depth'] for r in rr),
          'meanNodes':statistics.mean(r['nodes'] for r in rr),'nodeRatio':sum(r['nodes'] for r in rr)/sum(r['nodes'] for r in grouped['baseline']),
          'meanGapCp':statistics.mean(r['gapCp'] for r in eligible) if eligible else None,'meanDeltaGapCp':statistics.mean(deltas) if deltas else None,
          'deltaGap95':ci(deltas) if deltas else None,'improvedEqualWorseRoots':[sum(x<0 for x in deltas),sum(x==0 for x in deltas),sum(x>0 for x in deltas)],
          'meanPvLength':statistics.mean(r['pvLength'] for r in rr),'maxElapsedMs':max(r['elapsedMs'] for r in quality if r['variant']==name and r['budgetMs']==ms)}
for filename,rows in [('fixed.csv',fixed),('quality.csv',quality)]:
    with (D/filename).open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
(D/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='protocol'},indent=2))
