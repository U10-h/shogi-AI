#!/usr/bin/env python3
"""Compare archived/current search semantics with histories and bounded aborts."""
import hashlib,json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OLD=ROOT/'build/shogi-lab-v0.8';NEW=ROOT/'build/shogi-lab'
MODEL=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'
out={'binaries':{str(p.name):hashlib.sha256(p.read_bytes()).hexdigest() for p in [OLD,NEW]},'rows':[]}
rows=json.loads((ROOT/'results/v0.8/quality.json').read_text())['rows']
def run(binary,extra):
    r=subprocess.run([str(binary),'--advanced','--depth','3','--max-nodes','18000',*extra],capture_output=True,text=True)
    assert r.returncode in [0,3],r.stderr
    return json.loads(r.stdout)
keys=['score','bestmove','pv','nodes','completed_depth','has_result','complete','stop_reason','candidates','leaves','terminals','cutoffs']
def compare(label,extra):
    a=run(OLD,extra);b=run(NEW,extra)
    for k in keys:assert a.get(k)==b.get(k),(label,k,a.get(k),b.get(k))
    out['rows'].append({'case':label,'args':extra,'old':a,'final':b})
for i,root in enumerate(rows):
    for mode in ['material','positional','nnue']:
        extra=['--moves',' '.join(root['prefix']),'--preset','tactical','--eval',mode,'--iterative']
        if mode=='nnue':extra+=['--eval-model',str(MODEL)]
        compare(f'root-{i}-{mode}',extra)
    for preset in ['exact','selective']:
        compare(f'root-{i}-{preset}',['--moves',' '.join(root['prefix']),'--preset',preset,'--eval','nnue','--eval-model',str(MODEL),'--tt-entries','32'])
for name,sfen,moves in [
    ('draw','4k4/9/9/9/9/9/9/9/4K4 b - 1',' '.join(['5i4i 5a4a 4i5i 4a5a']*3)),
    ('perpetual','4k4/9/5R3/9/9/9/9/9/K8 b - 1',' '.join(['4c5c 5a4a 5c4c 4a5a']*3)),
    ('no-legal-move','k6r1/9/9/9/9/9/9/6r2/8K b - 1',''),
    ('only-drops','k6r1/9/9/9/9/9/9/6r2/8K b P 1',''),
    ('checked','4k4/9/9/9/9/4r4/9/9/4K4 b G 1','')]:
    for qdepth in [0,2,6]:
        compare(f'{name}-q{qdepth}',['--sfen',sfen,'--moves',moves,'--preset','tactical','--qdepth',str(qdepth),'--eval','nnue','--eval-model',str(MODEL)])
for driver in ['ab','pvs','aspiration','mtdf','sss','dual']:
    compare(f'driver-{driver}',['--preset','tactical','--driver',driver,'--iterative','--depth','2'])
for multipv in [1,5]:
    compare(f'multipv-{multipv}',['--preset','tactical','--multipv',str(multipv),'--depth','2'])
out['checks']=len(out['rows']);out['passed']=True
assert out['binaries']=={str(p.name):hashlib.sha256(p.read_bytes()).hexdigest() for p in [OLD,NEW]},'Binary changed during verification'
(ROOT/'results/v0.9/verification.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'passed':True,'searchConditions':out['checks'],'completed':sum(r['final']['complete'] for r in out['rows']),'limited':sum(not r['final']['complete'] for r in out['rows'])}))
