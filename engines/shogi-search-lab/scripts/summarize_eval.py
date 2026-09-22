#!/usr/bin/env python3
import csv,hashlib,json,platform,statistics,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'results/v0.7'
comparison=json.loads((OUT/'comparison.json').read_text());assert comparison['status']=='finished'
summary={'positions':len(comparison['rows']),'groups':len({r['group'] for r in comparison['rows']}),'comparison':{},'matches':{}}
flat=[]
for regime in ['depth3','time3000']:
    variants={v:[] for v in ['material','positional','learned']}
    for row in comparison['rows']:
        runs={r['variant']:r for r in row['runs'] if r['regime']==regime}
        for v,a in runs.items():
            b=runs['material'];variants[v].append(a)
            flat.append(dict(group=row['group'],offset=row['offset'],regime=regime,variant=v,move=a['bestmove'],score=a['score'],depth=a['completed_depth'],nodes=a['nodes'],elapsed_ms=a['elapsed_ms'],teacher_gap=a.get('teacherGap'),material_gap=b.get('teacherGap')))
    summary['comparison'][regime]={}
    base=variants['material']
    for v,rows in variants.items():
        pairs=[(a['teacherGap'],b['teacherGap']) for a,b in zip(rows,base) if 'teacherGap' in a and 'teacherGap' in b]
        summary['comparison'][regime][v]={
            'scored':len(pairs),'mean_gap':statistics.mean(a for a,b in pairs),'median_gap':statistics.median(a for a,b in pairs),
            'better_equal_worse':[sum(a<b for a,b in pairs),sum(a==b for a,b in pairs),sum(a>b for a,b in pairs)],
            'mean_depth':statistics.mean(a['completed_depth'] for a in rows),'mean_nodes':statistics.mean(a['nodes'] for a in rows),
            'mean_ms':statistics.mean(a['elapsed_ms'] for a in rows),
            'group_gaps':{g:statistics.mean(r['teacher_gap'] for r in flat if r['variant']==v and r['regime']==regime and r['group']==g and r['teacher_gap'] is not None) for g in {r['group'] for r in flat}}}
with (OUT/'comparison.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=list(flat[0]));w.writeheader();w.writerows(flat)
if (OUT/'matches.json').exists():
    matches=json.loads((OUT/'matches.json').read_text());summary['matchStatus']=matches['status']
    for opponent in ['material','yaneuraou']:
        for variant in sorted({g['candidate'] for g in matches['games'] if g['opponent']==opponent}):
            games=[g for g in matches['games'] if g['opponent']==opponent and g['candidate']==variant and g['status']=='finished']
            counts={'wins':0,'losses':0,'draws':0,'unresolved':0}
            for g in games:
                r=g['result'];kind='unresolved' if r.get('unresolved') else 'draws' if r['winner'] is None else 'wins' if r['winner']==g['candidateSide'] else 'losses'
                counts[kind]+=1
            summary['matches'][variant+'_vs_'+opponent]={'games':len(games),**counts}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2))
environment={'platform':platform.platform(),'python':platform.python_version(),'cpu':platform.processor(),
    'compiler':subprocess.check_output(['g++','--version'],text=True).splitlines()[0],
    'node':subprocess.check_output(['node','--version'],text=True).strip(),
    'binarySha256':hashlib.sha256((ROOT/'build/shogi-lab').read_bytes()).hexdigest(),
    'sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'src').glob('*')) if p.is_file()}}
(OUT/'environment.json').write_text(json.dumps(environment,indent=2))
print(json.dumps(summary,indent=2))
