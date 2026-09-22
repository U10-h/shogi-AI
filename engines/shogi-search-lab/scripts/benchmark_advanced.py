#!/usr/bin/env python3
"""Frozen reproducible ablations; sequential execution, no external packages."""
import argparse, hashlib, json, math, platform, random, statistics, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BIN=ROOT/'build/shogi-lab'
OUT=ROOT/'results/v0.5'
OUT.mkdir(parents=True,exist_ok=True)
def run(pos,args,timeout=90):
    cmd=[str(BIN),'--sfen',pos['initial'],'--moves',' '.join(pos.get('moves',[])),*args]
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=timeout)
    if p.returncode not in (0,3):raise RuntimeError(f'{cmd}: {p.stderr}')
    return json.loads(p.stdout)
def dump(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def prepare():
    source=json.loads((ROOT/'experiments/v0.4-protocol.json').read_text())['positions']
    seen=set();test=[]
    for p in source:
        key=(p['initial'],tuple(p['moves']))
        if key not in seen and p['depth']==3:
            seen.add(key);test.append(p)
    # Pre-existing, frozen conditions. No calibration data is drawn from these.
    train=[];rng=random.Random(5162901)
    initial=source[0]['initial']
    for game in range(8):
        moves=[]
        for ply in range(40):
            legal=run({'initial':initial,'moves':moves},['--legal'])['moves']
            if not legal:break
            moves.append(rng.choice(legal))
            if ply in (15,23,31,39):train.append({'id':f'cal-{game}-{ply+1}','game':game,'initial':initial,'moves':moves[:]})
    protocol={'seed':5162901,'training':train,'positions':test,'repeats':3,
      'exact_depth':3,'selective_depth':4,'selective_time_ms':1500,'selective_node_limit':200000,
      'timed_ms':3000,'notes':'Sequential cold processes. Timing excludes startup. Complete pairs only. Fixed and qsearch leaf policies separated. Not an Elo experiment. Calibration games 0..5 train, 6..7 validation.'}
    dump(ROOT/'experiments/v0.5-protocol.json',protocol)
    return protocol
def calibrate(protocol):
    rows=[]
    for p in protocol['training']:
        values={}
        for d in (1,2,3,4):
            r=run(p,['--advanced','--preset','exact','--depth',str(d),'--max-nodes','250000','--time-ms','3000'])
            if r['complete'] and abs(r['score'])<90000:values[d]=r['score']
        rows.append({'id':p['id'],'game':p['game'],'values':values})
    models=[];lines=['shogi-lab-probcut-v1 fixed_material']
    for deep,shallow in ((3,1),(3,2),(4,2),(4,1)):
        xy=[(r['values'][shallow],r['values'][deep]) for r in rows if r['game']<6 and shallow in r['values'] and deep in r['values']]
        if len(xy)<8:continue
        xs,ys=zip(*xy);xm,ym=statistics.mean(xs),statistics.mean(ys)
        variance=sum((x-xm)**2 for x in xs)
        if not variance:continue
        a=sum((x-xm)*(y-ym) for x,y in xy)/variance
        if a<=0:continue
        b=ym-a*xm;res=[y-(a*x+b) for x,y in xy]
        sigma=max(100,math.sqrt(sum(e*e for e in res)/max(1,len(res)-2)))
        val=[(r['values'][shallow],r['values'][deep]) for r in rows if r['game']>=6 and shallow in r['values'] and deep in r['values']]
        errors=[y-(a*x+b) for x,y in val]
        models.append({'deep':deep,'shallow':shallow,'slope':a,'intercept':b,'sigma':sigma,'z':2.5,'train_n':len(xy),'validation_n':len(val),'validation_rmse':math.sqrt(statistics.mean(e*e for e in errors)) if errors else None,'validation_outside_2_5_sigma':sum(abs(e)>2.5*sigma for e in errors)})
        lines.append(f'{deep} {shallow} {a:.12g} {b:.12g} {sigma:.12g} 2.5')
    if not models:raise RuntimeError('No eligible ProbCut model')
    (ROOT/'experiments/probcut-v0.5.txt').write_text('\n'.join(lines)+'\n')
    dump(OUT/'calibration.json',{'rows':rows,'models':models,'warning':'Small material-evaluation sample. Root calibration is not a guarantee for interior-node residuals; experimental only.'})
    print('calibrated',len(models),flush=True)
def configs():
    exact=[('legacy',['--algorithm','ordered']),('ab',['--advanced','--preset','baseline']),('pvs',['--advanced','--preset','baseline','--driver','pvs']),('tt',['--advanced','--features','tt']),('history',['--advanced','--features','history']),('killer',['--advanced','--features','killer']),('counter',['--advanced','--features','counter']),('exact',['--advanced','--preset','exact'])]
    exact += [(name,['--advanced','--preset','exact','--driver',name]) for name in ('aspiration','mtdf','sss','dual')]
    base='tt,history,killer,counter,mate-distance'
    exact += [(f,['--advanced','--features',base+','+f]) for f in ('iid','etc','see-order')]
    selective=[('exact', ['--advanced','--preset','exact']),('tactical',['--advanced','--preset','tactical']),('selective',['--advanced','--preset','selective'])]
    selective += [(f,['--advanced','--features',base+','+f]) for f in ('null','adaptive-null','verified-null','lmr','futility','reverse-futility','multicut','check-extension','recapture-extension','singular')]
    selective += [(f,['--advanced','--features',base+',qsearch,'+f]) for f in ('delta','see-prune','razoring')]
    selective += [(f,['--advanced','--features',base+','+f,'--probcut-model',str(ROOT/'experiments/probcut-v0.5.txt')]) for f in ('probcut','multiprobcut')]
    selective += [(f,['--advanced','--driver',f,'--features','qsearch']) for f in ('rps','erps')]
    return exact,selective

def benchmark(protocol,stage):
    exact,selective=configs();rows=[];target=OUT/f'{stage}.jsonl'
    if stage=='exact':variants=exact;positions=protocol['positions'];repeats=3;limits=['--depth','3','--iterative','--max-nodes','3000000']
    elif stage=='selective':variants=selective;positions=protocol['positions'][:8]+protocol['positions'][-4:];repeats=1;limits=['--depth','4','--iterative','--max-nodes','200000','--time-ms','1500']
    else:
        variants=[x for x in exact if x[0] in ('legacy','exact','aspiration','mtdf')]+[x for x in selective if x[0] in ('tactical','selective','erps')]
        positions=protocol['positions'][:6];repeats=1;limits=['--depth','8','--iterative','--max-nodes','10000000','--time-ms','3000']
    with target.open('w') as file:
        for i,p in enumerate(positions):
            for repeat in range(repeats):
                shift=(i+repeat)%len(variants);order=variants[shift:]+variants[:shift]
                for name,args in order:
                    r=run(p,args+limits)
                    row={'position':p['id'],'variant':name,'repeat':repeat,'result':r};rows.append(row);file.write(json.dumps(row,ensure_ascii=False)+'\n');file.flush()
            print(stage,i+1,'/',len(positions),p['id'],flush=True)
    summarize(stage,rows)
def summarize(stage,rows):
    baseline='legacy' if stage in ('exact','timed') else 'exact'
    by={}
    for row in rows:by.setdefault((row['position'],row['variant']),[]).append(row['result'])
    summaries={}
    for variant in sorted({r['variant'] for r in rows}):
        vals=[r['result'] for r in rows if r['variant']==variant];mismatch=0;paired=0;bn=vn=bt=vt=0
        for (position,name),runs in by.items():
            if name!=variant or (position,baseline) not in by:continue
            ref=by[position,baseline]
            if all(x['complete'] for x in runs+ref) and runs[0]['completed_depth']==ref[0]['completed_depth']:
                paired+=1;mismatch+=runs[0]['score']!=ref[0]['score'];bn+=statistics.median(x['nodes'] for x in ref);vn+=statistics.median(x['nodes'] for x in runs);bt+=statistics.median(x['elapsed_ms'] for x in ref);vt+=statistics.median(x['elapsed_ms'] for x in runs)
        stats={}
        for r in vals:
            for k,v in r.get('stats',{}).items():stats[k]=stats.get(k,0)+v
        summaries[variant]={'runs':len(vals),'complete':sum(x['complete'] for x in vals),'paired_positions':paired,'different_scores':mismatch,'node_ratio':vn/bn if bn else None,'time_ratio':vt/bt if bt else None,'median_completed_depth':statistics.median(x['completed_depth'] for x in vals),'stats':stats}
    dump(OUT/f'{stage}-summary.json',summaries)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('stage',choices=['prepare','calibrate','exact','selective','timed']);a=ap.parse_args()
    protocol=prepare() if a.stage=='prepare' else json.loads((ROOT/'experiments/v0.5-protocol.json').read_text())
    if a.stage=='prepare':
        dump(OUT/'environment.json',{'platform':platform.platform(),'python':platform.python_version(),'binary_sha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'compiler':subprocess.check_output(['g++','--version'],text=True).splitlines()[0]})
    elif a.stage=='calibrate':calibrate(protocol)
    else:benchmark(protocol,a.stage)
if __name__=='__main__':main()
