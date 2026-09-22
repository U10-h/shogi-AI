#!/usr/bin/env python3
"""Summarize recorded v0.9 data; never substitute inferred game results."""
import csv,json,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.9'
read=lambda name:json.loads((D/name).read_text())
s1=read('speed-cycle1.json');s2=read('speed-cycle2.json');quality=read('quality.json');matches=read('matches.json');verification=read('verification.json')
assert quality['status']==matches['status']=='finished'
assert len(quality['rows'])==12 and len(matches['games'])==4
assert s1['allSearchSignaturesEqual'] and s2['allSearchSignaturesEqual'] and verification['passed']
assert quality['binaries']==matches['binaries']
assert quality['binaries']['final']==verification['binaries']['shogi-lab']==s2['binaries']['cycle2']
assert quality['binaries']['old']==verification['binaries']['shogi-lab-v0.8']==s2['binaries']['v0.8']
summary={'speedCycle1':s1['summary'],'speedCycle2':s2['summary'],'verificationConditions':verification['checks'],'quality':{},'matches':{'wins':0,'losses':0,'draws':0,'unresolved':0,'moves':0,'pvMoves':0}}
for variant in ['old','final']:
    rows=[next(r for r in row['runs'] if r['variant']==variant) for row in quality['rows']]
    gaps=[r['teacherGap'] for r in rows if 'teacherGap' in r]
    summary['quality'][variant]={'meanDepth':statistics.mean(r['completed_depth'] for r in rows),'nodes':sum(r['nodes'] for r in rows),'meanGapCp':statistics.mean(gaps) if gaps else None,'gapRoots':len(gaps),'meanElapsedMs':statistics.mean(r['elapsed_ms'] for r in rows)}
better=equal=worse=deeper=shallower=0;quality_csv=[]
for i,row in enumerate(quality['rows']):
    a=next(r for r in row['runs'] if r['variant']=='old');b=next(r for r in row['runs'] if r['variant']=='final')
    if 'teacherGap' in a and 'teacherGap' in b:
        better+=b['teacherGap']<a['teacherGap'];equal+=b['teacherGap']==a['teacherGap'];worse+=b['teacherGap']>a['teacherGap']
    deeper+=b['completed_depth']>a['completed_depth'];shallower+=b['completed_depth']<a['completed_depth']
    quality_csv.append({'root':i,'group':row['group'],'offset':row['offset'],'oldMove':a['bestmove'],'finalMove':b['bestmove'],'oldDepth':a['completed_depth'],'finalDepth':b['completed_depth'],'oldGapCp':a.get('teacherGap'),'finalGapCp':b.get('teacherGap'),'oldNodes':a['nodes'],'finalNodes':b['nodes']})
summary['quality'].update({'better':better,'equal':equal,'worse':worse,'deeper':deeper,'shallower':shallower})
for g in matches['games']:
    assert g['status']=='finished' and g['result']
    m=summary['matches'];r=g['result'];m['moves']+=len(g['moves']);m['pvMoves']+=sum(len(x['analysis']['pv']) for x in g['moves'])
    if r.get('unresolved'):m['unresolved']+=1
    elif r['winner'] is None:m['draws']+=1
    elif r['winner']==g['candidateSide']:m['wins']+=1
    else:m['losses']+=1
summary['matches']['fallbacks']={v:sum(1 for g in matches['games'] for e in g['moves'] if e['variant']==v and e.get('fallback')) for v in ['old','final']}
summary['matches']['audit']='match-audit.json'
with (D/'quality.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=list(quality_csv[0]));w.writeheader();w.writerows(quality_csv)
with (D/'speed.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=['phase','root','repeat','variant','elapsed_ms','nodes','q_generated_moves','q_avoided_generations']);w.writeheader()
    for phase,data in [('cycle1',s1),('cycle2',s2)]:
        for r in data['rows']:w.writerow({'phase':phase,**{k:r[k] for k in ['root','repeat','variant','elapsed_ms','nodes']},'q_generated_moves':r['stats'].get('q_generated_moves'),'q_avoided_generations':r['stats'].get('q_avoided_generations')})
(D/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if not k.startswith('speed')},indent=2))
