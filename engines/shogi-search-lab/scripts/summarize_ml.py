#!/usr/bin/env python3
"""Final metrics, game-cluster uncertainty and all held-out per-root observations."""
import csv,hashlib,json,statistics
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.10'
frozen=json.loads((D/'frozen-model.json').read_text());name=frozen['selected']
def read_rows(directory):return [json.loads(p.read_text()) for p in sorted((D/directory).glob('*.json'))]
def ci_group(values,groups):
    ids=sorted(set(groups));bucket={g:[v for v,gg in zip(values,groups) if gg==g] for g in ids};rng=np.random.default_rng(20260925)
    draws=[np.mean([v for g in rng.choice(ids,len(ids),replace=True) for v in bucket[g]]) for _ in range(5000)]
    return np.quantile(draws,[.025,.975]).tolist()
def compare(rows,names):
    out={'roots':len(rows),'games':len({r['game'] for r in rows}),'models':{}}
    ordinary=[r for r in rows if all(c['type']=='cp' and abs(c['score'])<8000 for c in r['candidates'])]
    diagnostic={'criterion':'All candidate scores are cp with abs(score)<8000. Supplementary range diagnostic; primary rankings retain all roots.','roots':len(ordinary),'excludedTasks':[r['task'] for r in rows if r not in ordinary],'models':{}}
    for n in names:
        rr=[next(x for x in r['runs'] if x['variant']==n) for r in rows];gaps=[x['teacherGapCp'] for x in rr if x['teacherGapCp'] is not None]
        out['models'][n]={'cpRoots':len(gaps),'meanGapCp':statistics.mean(gaps) if gaps else None,'p95GapCp':float(np.quantile(gaps,.95)) if gaps else None,'meanDepth':statistics.mean(r['completed_depth'] for r in rr),'nodes':sum(r['nodes'] for r in rr),'fallbacks':sum(r.get('fallback',False) for r in rr),'meanElapsedMs':statistics.mean(r['elapsed_ms'] for r in rr)}
        ordinary_gaps=[next(x for x in r['runs'] if x['variant']==n)['teacherGapCp'] for r in ordinary]
        diagnostic['models'][n]={'meanGapCp':statistics.mean(ordinary_gaps) if ordinary_gaps else None}
        if n!='base':
            diffs=[];groups=[];improved=equal=worse=0;examples=[]
            for r in rows:
                a=next(x for x in r['runs'] if x['variant']=='base');b=next(x for x in r['runs'] if x['variant']==n)
                delta=b['teacherUtilityGap']-a['teacherUtilityGap'];improved+=delta<0;equal+=delta==0;worse+=delta>0
                if a['teacherGapCp'] is not None and b['teacherGapCp'] is not None:
                    diff=b['teacherGapCp']-a['teacherGapCp'];diffs.append(diff);groups.append(r['game'])
                    examples.append({'task':r['task'],'game':r['game'],'ply':r['ply'],'baseMove':a['chosenMove'],'candidateMove':b['chosenMove'],'baseGapCp':a['teacherGapCp'],'candidateGapCp':b['teacherGapCp'],'deltaCp':diff,'baseDepth':a['completed_depth'],'candidateDepth':b['completed_depth'],'sfen':r['sfen']})
            out['models'][n].update({'better':improved,'equal':equal,'worse':worse,'meanPairedDeltaCp':statistics.mean(diffs) if diffs else None,'pairedGameBootstrap95':ci_group(diffs,groups) if diffs else None,'mostImproved':sorted(examples,key=lambda r:r['deltaCp'])[:5],'mostRegressed':sorted(examples,key=lambda r:r['deltaCp'],reverse=True)[:5]})
            od=[next(x for x in r['runs'] if x['variant']==n)['teacherGapCp']-next(x for x in r['runs'] if x['variant']=='base')['teacherGapCp'] for r in ordinary]
            diagnostic['models'][n].update({'meanPairedDeltaCp':statistics.mean(od) if od else None,'pairedGameBootstrap95':ci_group(od,[r['game'] for r in ordinary]) if od else None})
    out['ordinaryScoreDiagnostic']=diagnostic
    return out
validation={stage:compare(read_rows('quality-'+stage),names) for stage,names in [('naive',['base','naive']),('rebuild',['base','naive','anchored25','anchored50']),('biascontrol',['base','anchored50','tempo40'])]}
tests=read_rows('quality-test');assert len(tests)==120 and all(r['status']=='finished' for r in tests)
for r in tests:
    assert r['modelHashes'][name]==frozen['modelSha256'] and r['binarySha256']==frozen['binarySha256']
    assert r['teacherAllLegalMoves'] is True
test={str(ms):compare([r for r in tests if r['ms']==ms],['base',name]) for ms in [1000,3000]}
(D/'test-quality-summary.json').write_text(json.dumps(test,indent=2)+'\n')
games=read_rows('matches');assert len(games)==32 and all(g['status']=='finished' for g in games)
matches={'games':32,'openingPairs':16,'wins':0,'losses':0,'draws':0,'unresolved':0,'plies':0,'pvMoves':0,'fallbacks':{'base':0,name:0},'rows':[]}
scores=[];groups=[]
for g in games:
    assert g['modelSha256']==frozen['modelSha256'] and g['binarySha256']==frozen['binarySha256']
    result=g['result'];score=None
    if result.get('unresolved'):matches['unresolved']+=1
    elif result['winner'] is None:matches['draws']+=1;score=.5
    elif result['winner']==g['candidateSide']:matches['wins']+=1;score=1
    else:matches['losses']+=1;score=0
    if score is not None:scores.append(score);groups.append(g['index']//2)
    matches['plies']+=len(g['moves']);matches['pvMoves']+=sum(len(m['analysis']['pv']) for m in g['moves'])
    for m in g['moves']:matches['fallbacks'][m['variant']]+=m['fallback']
    matches['rows'].append({'id':g['id'],'candidateSide':g['candidateSide'],'plies':len(g['moves']),'result':result})
if not matches['unresolved']:
    matches['scoreRate']=statistics.mean(scores);matches['pairedOpeningBootstrap95']=ci_group(scores,groups)
out={'frozen':frozen,'data':json.loads((D/'dataset-summary.json').read_text()),'staticTest':json.loads((D/'static-test.json').read_text()),'validation':validation,'test':test,'matches':matches}
(D/'summary.json').write_text(json.dumps(out,indent=2)+'\n')
with (D/'test-comparison.csv').open('w') as f:
    columns=['task','game','ply','ms','baseMove','candidateMove','baseDepth','candidateDepth','baseGapCp','candidateGapCp','baseNodes','candidateNodes'];w=csv.DictWriter(f,fieldnames=columns);w.writeheader()
    for r in tests:
        a=next(x for x in r['runs'] if x['variant']=='base');b=next(x for x in r['runs'] if x['variant']==name)
        w.writerow({'task':r['task'],'game':r['game'],'ply':r['ply'],'ms':r['ms'],'baseMove':a['chosenMove'],'candidateMove':b['chosenMove'],'baseDepth':a['completed_depth'],'candidateDepth':b['completed_depth'],'baseGapCp':a['teacherGapCp'],'candidateGapCp':b['teacherGapCp'],'baseNodes':a['nodes'],'candidateNodes':b['nodes']})
print(json.dumps({'test':test,'matches':matches},indent=2))
