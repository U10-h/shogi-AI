#!/usr/bin/env python3
"""Sequential paired exact-search benchmarks. Build/test before running."""
import argparse,hashlib,json,os,platform,statistics,subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--phase',choices=['cycle1','cycle2'],required=True)
p.add_argument('--repeats',type=int,default=5);args=p.parse_args()
MODEL=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'
current=ROOT/'build/shogi-lab';old=ROOT/'build/shogi-lab-v0.8'
if args.phase=='cycle1':
    variants=[('v0.8',old,[]),('control',current,['--legacy-order','--full-qmoves','--eager-qmoves']),
              ('order',current,['--full-qmoves','--eager-qmoves']),('direct',current,['--legacy-order','--eager-qmoves']),('cycle1',current,['--eager-qmoves'])]
else:
    variants=[('v0.8',old,[]),('cycle1',current,['--eager-qmoves']),('cycle2',current,[])]
roots=json.loads((ROOT/'results/v0.7/comparison.json').read_text())['rows'][:8]
out=ROOT/'results/v0.9'/('speed-'+args.phase+'.json')
result={'phase':args.phase,'platform':platform.platform(),'repeats':args.repeats,
        'modelSha256':hashlib.sha256(MODEL.read_bytes()).hexdigest(),
        'binaries':{n:hashlib.sha256(b.read_bytes()).hexdigest() for n,b,_ in variants},'rows':[]}
signatures={}
# One discarded warm-up per variant, before all measurements.
for _,binary,flags in variants:
    subprocess.run([str(binary),'--advanced','--preset','tactical','--eval','nnue','--eval-model',str(MODEL),'--depth','2',*flags],capture_output=True,check=True)
for repeat in range(args.repeats):
    for i,root in enumerate(roots):
        for j in range(len(variants)):
            name,binary,flags=variants[(i+repeat+j)%len(variants)]
            cmd=[str(binary),'--sfen',root['sfen'],'--advanced','--preset','tactical','--eval','nnue','--eval-model',str(MODEL),'--depth','3','--max-nodes','1000000000',*flags]
            r=json.loads(subprocess.check_output(cmd,text=True))
            signature=[r[k] for k in ['score','bestmove','pv','nodes','completed_depth','stop_reason','candidates']]
            if i in signatures:assert signature==signatures[i],(i,name,'search mismatch')
            signatures[i]=signature
            result['rows'].append({'root':i,'repeat':repeat,'variant':name,**r})
        out.write_text(json.dumps(result,indent=2)+'\n')
    print('round',repeat+1,flush=True)
summary={}
for name,_,_ in variants:
    rows=[r for r in result['rows'] if r['variant']==name]
    medians=[statistics.median(r['elapsed_ms'] for r in rows if r['root']==i) for i in range(len(roots))]
    summary[name]={'meanMs':statistics.mean(r['elapsed_ms'] for r in rows),'sumRootMedianMs':sum(medians),'rootMedianMs':medians,
                   'nodesPerRound':sum(r['nodes'] for r in rows if r['repeat']==0),
                   'statsPerRound':{k:sum(r['stats'].get(k,0) for r in rows if r['repeat']==0) for k in sorted(set().union(*(r['stats'] for r in rows)))}}
base=summary['v0.8']['sumRootMedianMs']
for s in summary.values():s['reductionVsOldPct']=100*(1-s['sumRootMedianMs']/base)
result['summary']=summary;result['allSearchSignaturesEqual']=True
out.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(summary,indent=2),flush=True)
