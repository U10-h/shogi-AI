"""Reanalyse fixed prior decisions at depth 16 and the serial speed replication."""
import csv
import hashlib
import json
import os
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PRIOR = Path(os.environ.get('V21_PRIOR', ROOT/'results/retrospective-20260927'))
OUT = Path(os.environ.get('V21_RESUME', ROOT/'results/verification-resume-20260927'))
def read(p): return json.loads(Path(p).read_text())
def write(name, x): (OUT/name).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def csvout(name, rows):
    with (OUT/name).open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
def interval(ds):
    groups=sorted({g for g,d in ds})
    sums=np.array([sum(d for g,d in ds if g==k) for k in groups],float)
    counts=np.array([sum(g==k for g,d in ds) for k in groups],float)
    ix=np.random.default_rng(270927).integers(0,len(groups),(10000,len(groups)))
    return np.percentile(sums[ix].sum(axis=1)/counts[ix].sum(axis=1),[2.5,97.5]).tolist()
def comp(rows, a, ams, b, bms):
    left={r['id']:r for r in rows if r['variant']==a and r['ms']==ams and r['gap'] is not None}
    right={r['id']:r for r in rows if r['variant']==b and r['ms']==bms and r['gap'] is not None}
    ds=[(left[k]['game'],left[k]['gap']-right[k]['gap']) for k in sorted(left.keys()&right.keys())]
    return dict(a=a,a_ms=ams,b=b,b_ms=bms,n=len(ds),delta=float(np.mean([d for g,d in ds])),
                ci=interval(ds),improved=sum(d<0 for g,d in ds),same=sum(d==0 for g,d in ds),worse=sum(d>0 for g,d in ds))

roots=read(OUT/'roots.json'); assert len(roots)==24
manifest=read(ROOT/'results/retrospective-20260927/manifest.json')
bad=[x['path'] for x in manifest['files'] if not (PRIOR/x['path']).exists() or hashlib.sha256((PRIOR/x['path']).read_bytes()).hexdigest()!=x['sha256']]
if bad: raise ValueError(('Historical manifest mismatch',bad))
teachers={depth:{r['id']:read((PRIOR/'teacher' if depth==12 else OUT/'depth16')/(r['id']+'.json'))['candidates'] for r in roots} for depth in [12,16]}
valid={depth:{key for key,cs in ts.items() if all(c['type']=='cp' and abs(c['score'])<30000 for c in cs)} for depth,ts in teachers.items()}
for r in roots:
    assert {c['move'] for c in teachers[12][r['id']]}=={c['move'] for c in teachers[16][r['id']]}
rows=[]
for f in sorted((PRIOR/'quality').glob('*.json')):
    d=read(f);rid=d['root']['id']
    for depth in [12,16]:
        scores={c['move']:c['score'] for c in teachers[depth][rid]} if rid in valid[depth] else {}
        for a in d['runs']:
            rows.append(dict(depth=depth,id=rid,game=d['root']['game'],ms=d['ms'],variant=a['variant'],move=a['chosenMove'],
                gap=max(scores.values())-scores[a['chosenMove']] if scores else None,common_eligible=rid in valid[12]&valid[16]))
assert len(rows)==768
csvout('quality-rescored.csv',rows)
quality=[];comparisons=[];time_benefit=[]
for depth in [12,16]:
    rr=[r for r in rows if r['depth']==depth]
    for ms in [300,1000,3000,5000]:
        for name in ['traditional','capture','lmr','adaptive','latest']:
            rs=[r for r in rr if r['ms']==ms and r['variant']==name and r['gap'] is not None]
            if rs: quality.append(dict(depth=depth,ms=ms,variant=name,n=len(rs),gap=float(np.mean([r['gap'] for r in rs])),over100=sum(r['gap']>100 for r in rs)))
    for ms in [300,1000,3000]:
        for a,b in [('latest','capture'),('latest','lmr'),('latest','adaptive'),('capture','traditional')]:
            comparisons.append(dict(depth=depth,**comp(rr,a,ms,b,ms)))
    for a,b in [(300,1000),(1000,3000),(3000,5000),(1000,5000)]:
        time_benefit.append(dict(depth=depth,**comp(rr,'latest',b,'latest',a)))
csvout('quality-summary.csv',quality)
csvout('quality-comparisons.csv',comparisons)
common_comparisons=[dict(depth=depth,**comp([r for r in rows if r['depth']==depth and r['common_eligible']],'latest',3000,b,3000)) for depth in [12,16] for b in ['capture','lmr','adaptive']]
speed=[];historical=[]
for f in sorted((OUT/'speed').glob('*.json')):
    d=read(f);assert d['equivalent'];historical.append(d['historicalMatches'])
    for a in d['runs']: speed.append(dict(id=d['root']['id'],game=d['root']['game'],rep=d['rep'],variant=a['variant'],nodes=a['nodes'],elapsed_ms=a['elapsed_ms'],wall_ms=a['wallMs']))
assert len(speed)==216 and len(historical)==72
csvout('speed.csv',speed)
med=lambda variant,field:{r['id']:float(np.median([a[field] for a in speed if a['id']==r['id'] and a['variant']==variant])) for r in roots}
base=med('nocache','elapsed_ms');basewall=med('nocache','wall_ms');speeds=[]
for variant in ['nocache','latest','scalar']:
    values=med(variant,'elapsed_ms');wall=med(variant,'wall_ms')
    aa=np.array([sum(values[r['id']] for r in roots if r['game']==g) for g in range(8)])
    bb=np.array([sum(base[r['id']] for r in roots if r['game']==g) for g in range(8)])
    ix=np.random.default_rng(270927).integers(0,8,(10000,8))
    speeds.append(dict(variant=variant,sum_median_ms=sum(values.values()),ratio=sum(values.values())/sum(base.values()),
        ci=np.percentile(aa[ix].sum(axis=1)/bb[ix].sum(axis=1),[2.5,97.5]).tolist(),faster_roots=sum(values[k]<base[k] for k in values),
        wall_ratio=sum(wall.values())/sum(basewall.values())))
repeated=[]
for f in sorted((PRIOR/'depth16').glob('*.json')):
    d=read(f)
    if 'candidates' not in d:continue
    new=teachers[16][d['root']['id']]
    oldmap={c['move']:(c['type'],c['score']) for c in d['candidates']};newmap={c['move']:(c['type'],c['score']) for c in new}
    repeated.append(dict(id=d['root']['id'],scores_equal=oldmap==newmap))
audit=dict(passed=True,historical_manifest_files=len(manifest['files']),historical_manifest_mismatches=bad,
    prior=read(OUT/'prior-audit.json'),new_speed_searches=len(speed),equivalent_blocks=len(historical),
    historical_equivalent_blocks=sum(historical),new_teacher_roots=24,new_teacher_candidates=sum(len(c) for c in teachers[16].values()),
    new_games=0,scope='Prior independent rules replay; every new speed/teacher PV checked by tsshogi at measurement; completeness and original candidate membership checked at aggregation.')
write('audit.json',audit)
summary=dict(audit=audit,eligibility={str(d):dict(included=sorted(valid[d]),excluded=sorted(set(teachers[d])-valid[d])) for d in [12,16]},
    common_eligible=sorted(valid[12]&valid[16]),speed=speeds,quality=quality,comparisons=comparisons,common_comparisons=common_comparisons,
    time_benefit=time_benefit,repeated_teacher_roots=repeated,prior_summary=read(PRIOR/'summary.json'))
write('summary.json',summary)
files=[]
for p in sorted(OUT.rglob('*')):
    if p.is_file() and p.name not in ['manifest.json','raw-results.tar.gz']:
        files.append(dict(path=str(p.relative_to(OUT)),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
write('manifest.json',dict(files=files))
print(json.dumps({k:summary[k] for k in ['audit','eligibility','speed','common_comparisons','time_benefit','repeated_teacher_roots']},ensure_ascii=False,indent=2))
