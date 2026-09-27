#!/usr/bin/env python3
"""Summarize frozen experiments; intervals resample trajectories, not searches."""
import csv, json, os
from pathlib import Path
import numpy as np
R=Path(__file__).resolve().parents[1]
D=Path(os.environ.get('V21_RESULTS',R/'results/retrospective-20260927'))
def read(p): return json.loads(Path(p).read_text())
def write(name,obj): (D/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def csvout(name,rows):
    if not rows:return
    with (D/name).open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
def avg(a): return float(np.mean(a)) if len(a) else None
def pct(a,p):return float(np.percentile(a,p)) if len(a) else None
def interval(a):
    rng=np.random.default_rng(270927)
    a=np.array(a,dtype=float)
    return np.percentile(a[rng.integers(0,len(a),(10000,len(a)))].mean(axis=1),[2.5,97.5]).tolist()
def clustered_delta_interval(ds):
    groups=sorted({g for g,d in ds})
    sums=np.array([sum(d for g,d in ds if g==group) for group in groups],float)
    sizes=np.array([sum(g==group for g,d in ds) for group in groups],float)
    ix=np.random.default_rng(270927).integers(0,len(groups),(10000,len(groups)))
    return np.percentile(sums[ix].sum(axis=1)/sizes[ix].sum(axis=1),[2.5,97.5]).tolist()
p=read(D/'protocol.json');summary={'protocol':p,'incomplete':[]}
roots=read(D/'roots.json')
rows=[]
for f in sorted((D/'quality').glob('*.json')):
    d=read(f);tp=D/'teacher'/f"{d['root']['id']}.json";cs=read(tp)['candidates'] if tp.exists() else []
    valid=bool(cs) and all(c['type']=='cp' and abs(c['score'])<30000 for c in cs)
    scores={c['move']:c['score'] for c in cs} if valid else {}
    for a in d['runs']:
        rows.append(dict(id=d['root']['id'],game=d['root']['game'],ms=d['ms'],variant=a['variant'],move=a['chosenMove'],gap=max(scores.values())-scores[a['chosenMove']] if valid else None,nodes=a['nodes'],elapsed_ms=a['elapsed_ms'],wall_ms=a['wallMs'],completed=a['has_result'],iteration=a['completed_depth'],normal_depth=a['completed_depth'] if a['iteration_unit']=='plies' else None,seldepth=a['stats'].get('selective_depth',0),pv_length=a['pvLength'],qnodes=a['stats'].get('qnodes',0),qleaf_depth=a['stats'].get('qreturn_ply_sum',0)/max(1,a['stats'].get('qreturn_count',0)),cache_hits=a['stats'].get('nnue_position_hits',0),stop=a['stop_reason']))
csvout('quality.csv',rows)
qs=[]
for ms in sorted(set(r['ms'] for r in rows)):
    for name in p['names']:
        rs=[r for r in rows if r['ms']==ms and r['variant']==name]
        if not rs:continue
        cp=[r for r in rs if r['gap'] is not None]
        qs.append(dict(ms=ms,variant=name,n=len(rs),cp_n=len(cp),gap=avg([r['gap'] for r in cp]),gap_median=pct([r['gap'] for r in cp],50),gap_p90=pct([r['gap'] for r in cp],90),gap_over100=sum(r['gap']>100 for r in cp),nodes_mean=avg([r['nodes'] for r in rs]),nps=sum(r['nodes'] for r in rs)/sum(r['elapsed_ms'] for r in rs)*1000,elapsed_mean=avg([r['elapsed_ms'] for r in rs]),elapsed_p95=pct([r['elapsed_ms'] for r in rs],95),wall_mean=avg([r['wall_ms'] for r in rs]),wall_p95=pct([r['wall_ms'] for r in rs],95),max_overshoot_ms=max(r['elapsed_ms']-ms for r in rs),over5pct=sum(r['elapsed_ms']>ms*1.05+5 for r in rs),normal_depth=avg([r['normal_depth'] for r in rs if r['normal_depth'] is not None]),iteration_mean=avg([r['iteration'] for r in rs]),seldepth_mean=avg([r['seldepth'] for r in rs]),pv_mean=avg([r['pv_length'] for r in rs]),qnode_fraction=sum(r['qnodes'] for r in rs)/sum(r['nodes'] for r in rs),completed=sum(r['completed'] for r in rs)))
summary['quality']=qs;csvout('quality-summary.csv',qs)
comparisons=[]
for ms in p['qualityMs']:
    for a,b in [('latest','capture'),('latest','lmr'),('latest','adaptive'),('capture','traditional')]:
        left={r['id']:r for r in rows if r['ms']==ms and r['variant']==a and r['gap'] is not None}
        right={r['id']:r for r in rows if r['ms']==ms and r['variant']==b and r['gap'] is not None}
        ds=[(left[k]['game'],left[k]['gap']-right[k]['gap']) for k in left.keys()&right.keys()]
        if ds:
            clusters=[avg([d for g,d in ds if g==game]) for game in sorted({g for g,d in ds})]
            comparisons.append(dict(ms=ms,a=a,b=b,n=len(ds),mean_delta=avg([d for g,d in ds]),ci=clustered_delta_interval(ds),improved=sum(d<0 for g,d in ds),same=sum(d==0 for g,d in ds),worse=sum(d>0 for g,d in ds),clusters=len(clusters)))
summary['quality_comparisons']=comparisons
tb=[]
for a,b in [(300,1000),(1000,3000),(3000,5000),(1000,5000)]:
    left={r['id']:r for r in rows if r['ms']==a and r['variant']=='latest' and r['gap'] is not None}
    right={r['id']:r for r in rows if r['ms']==b and r['variant']=='latest' and r['gap'] is not None}
    ds=[(k,right[k]['gap']-left[k]['gap']) for k in left.keys()&right.keys()]
    tb.append(dict(from_ms=a,to_ms=b,n=len(ds),mean_delta=avg([d for k,d in ds]),improved=sum(d<0 for k,d in ds),same=sum(d==0 for k,d in ds),worse=sum(d>0 for k,d in ds),changed=[{'id':k,'delta':d,'from':left[k]['move'],'to':right[k]['move']} for k,d in ds if d]))
summary['time_benefit']=tb
speed=[]
for f in sorted((D/'speed').glob('*.json')):
    d=read(f)
    for a in d['runs']:speed.append(dict(id=d['root']['id'],game=d['root']['game'],rep=d['rep'],variant=a['variant'],elapsed_ms=a['elapsed_ms'],wall_ms=a['wallMs'],nodes=a['nodes']))
csvout('speed.csv',speed)
ss=[]
for v in ['nocache','latest','scalar']:
    med={r['id']:float(np.median([x['elapsed_ms'] for x in speed if x['id']==r['id'] and x['variant']==v])) for r in roots}
    base={r['id']:float(np.median([x['elapsed_ms'] for x in speed if x['id']==r['id'] and x['variant']=='nocache'])) for r in roots}
    games=sorted({r['game'] for r in roots});aa=np.array([sum(med[r['id']] for r in roots if r['game']==g) for g in games]);bb=np.array([sum(base[r['id']] for r in roots if r['game']==g) for g in games])
    ix=np.random.default_rng(270927).integers(0,len(games),(10000,len(games)));ci=np.percentile(aa[ix].sum(axis=1)/bb[ix].sum(axis=1),[2.5,97.5]).tolist()
    wall={r['id']:float(np.median([x['wall_ms'] for x in speed if x['id']==r['id'] and x['variant']==v])) for r in roots}
    wallbase={r['id']:float(np.median([x['wall_ms'] for x in speed if x['id']==r['id'] and x['variant']=='nocache'])) for r in roots}
    ss.append(dict(variant=v,sum_median_ms=sum(med.values()),ratio_to_nocache=sum(med.values())/sum(base.values()),ci=ci,wall_sum_median_ms=sum(wall.values()),wall_ratio_to_nocache=sum(wall.values())/sum(wallbase.values()),faster_roots=sum(med[k]<base[k] for k in med),roots=len(roots),medians=med))
summary['speed']=ss;summary['speed_comparisons']=len(speed)
hard=[]
for f in sorted((D/'hard').glob('*.json')):
    d=read(f)
    for a in d['runs']:hard.append(dict(id=f.stem,ms=d['ms'],variant=a['variant'],completed=a['has_result'],iteration=a['completed_depth'],nodes=a['nodes'],qnodes=a['stats'].get('qnodes',0),fallback=a['fallback_source'],move=a['chosenMove']))
csvout('hard.csv',hard)
summary['hard']=[dict(ms=ms,variant=v,n=len(rs),completed=sum(r['completed'] for r in rs),qfraction=sum(r['qnodes'] for r in rs)/sum(r['nodes'] for r in rs)) for ms in p['hardMs'] for v in p['names'] if (rs:=[r for r in hard if r['ms']==ms and r['variant']==v])]
games=[];moves=[]
for f in sorted((D/'matches').glob('*.json')):
    d=read(f)
    if d['status']!='finished':summary['incomplete'].append(d['id']);continue
    r=d['result'];outcome='unresolved' if r.get('unresolved') else 'draw' if r['winner'] is None else 'win' if r['winner']==d['aSide'] else 'loss'
    games.append(dict(id=d['id'],a=d['a'],b=d['b'],suite=d.get('suite','generated'),opening=d['opening']['game'],side=d['aSide'],ms=d['ms'],opponent_ms=d['opponentMs'],plies=len(d['moves'])+len(d['opening']['prefix']),played_plies=len(d['moves']),outcome=outcome,reason=r['reason']))
    for m in d['moves']:
        a=m['analysis'];is_y=m['variant']=='yaneuraou';s=a.get('info') or {} if is_y else a
        moves.append(dict(game=d['id'],ply=m['ply'],variant=m['variant'],requested_ms=d['ms'] if m['side']==d['aSide'] else d['opponentMs'],nodes=s.get('nodes',0),elapsed_ms=s.get('time',0) if is_y else a['elapsed_ms'],wall_ms=m['wallMs'],completed=True if is_y else a['has_result'],iteration=s.get('depth',0) if is_y else a['completed_depth'],seldepth=None if is_y else a['stats'].get('selective_depth',0),pv_length=len(s.get('pv',[])) if is_y else a['pvLength']))
csvout('games.csv',games);csvout('match-moves.csv',moves)
gs=[]
for a,b,suite in [(a,b,'generated') for a,b in p['pairs']]+[(v,'yaneuraou',suite) for suite in ['generated','startpos'] for v in p['yaneuraVariants']]:
    rs=[r for r in games if r['a']==a and r['b']==b and r['suite']==suite]
    if not rs:continue
    counts={v:sum(r['outcome']==v for r in rs) for v in ['win','loss','draw','unresolved']};n=len(rs);lo=(counts['win']+.5*counts['draw'])/n;hi=lo+counts['unresolved']/n
    clusters=[avg([{'win':1,'loss':0,'draw':.5,'unresolved':.5}[r['outcome']] for r in rs if r['opening']==o]) for o in sorted({r['opening'] for r in rs})]
    gs.append(dict(a=a,b=b,suite=suite,n=n,**counts,score_bounds=[lo,hi],score_with_unresolved_half=(lo+hi)/2,descriptive_pair_ci=interval(clusters),opening_clusters=len(clusters),mean_plies=avg([r['plies'] for r in rs])))
summary['games']=gs;summary['game_count']=len(games);summary['match_move_count']=len(moves)
summary['match_metrics']=[]
for v in set(m['variant'] for m in moves):
    for ms in sorted(set(m['requested_ms'] for m in moves if m['variant']==v)):
        rs=[m for m in moves if m['variant']==v and m['requested_ms']==ms]
        summary['match_metrics'].append(dict(variant=v,ms=ms,n=len(rs),fallback=sum(not r['completed'] for r in rs),elapsed_mean=avg([r['elapsed_ms'] for r in rs]),elapsed_p95=pct([r['elapsed_ms'] for r in rs],95),wall_mean=avg([r['wall_ms'] for r in rs]),max_elapsed=max(r['elapsed_ms'] for r in rs),nodes_mean=avg([r['nodes'] for r in rs]),pv_mean=avg([r['pv_length'] for r in rs])))
diagnostics=[]
specs=[('0-44','latest',3000,'capture',3000),('7-44','latest',3000,'capture',3000),('4-44','latest',3000,'capture',3000),('7-28','latest',3000,'capture',3000),('3-60','latest',5000,'latest',3000),('3-28','latest',5000,'latest',3000),('4-28','latest',1000,'latest',300)]
for id,a,ams,b,bms in specs:
    path=D/'depth16'/f'{id}.json'
    if not path.exists():continue
    def chosen(v,ms):return next(r['move'] for r in rows if r['id']==id and r['variant']==v and r['ms']==ms)
    ma,mb=chosen(a,ams),chosen(b,bms)
    for depth,cs in [(12,read(D/'teacher'/f'{id}.json')['candidates']),(16,read(path)['candidates'])]:
        ca=next(c for c in cs if c['move']==ma);cb=next(c for c in cs if c['move']==mb)
        diagnostics.append(dict(id=id,a=a,a_ms=ams,a_move=ma,b=b,b_ms=bms,b_move=mb,depth=depth,a_type=ca['type'],a_score=ca['score'],b_type=cb['type'],b_score=cb['score'],cp_benefit=ca['score']-cb['score'] if ca['type']==cb['type']=='cp' and max(abs(ca['score']),abs(cb['score']))<30000 else None))
summary['depth_sensitivity']=diagnostics;csvout('depth-sensitivity.csv',diagnostics)
summary['counts']={'quality':len(rows),'speed':len(speed),'hard':len(hard),'games':len(games),'moves':len(moves),'teachers':len(list((D/'teacher').glob('*.json')))}
write('summary.json',summary)
print(json.dumps({k:summary[k] for k in ['counts','speed','quality_comparisons','games','hard']},ensure_ascii=False,indent=2))
