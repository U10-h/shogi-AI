"""Integer inference parity, trace transparency, and one post-hoc depth diagnosis."""
import json,gzip,hashlib,os,subprocess
from pathlib import Path
import numpy as np
from ml_nnue import full_features,read_model,head_score
R=Path(__file__).resolve().parents[1];D=R/'results/v0.12'
def read(p):return json.loads(p.read_text())
def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
assets=Path(os.environ['YANEURAOU_ASSETS']);base=read_model(assets/'yaneuraou.data')
models={'base':assets/'yaneuraou.data','pair':R/'build/models/v0.12/pair100.nnue','affine':R/'build/models/v0.12/affine-gap.nnue','anchored50':R/'build/models/v0.10/anchored50.nnue','tempo40':R/'build/models/v0.10/tempo40.nnue'}
def run(root,name,extra,binary='shogi-lab'):
    p=subprocess.run([str(R/'build'/binary),'--moves',' '.join(root['prefix']),'--advanced','--preset','tactical','--eval','nnue','--eval-model',str(models[name]),*extra],capture_output=True,text=True)
    assert p.returncode in [0,3],p.stderr
    return json.loads(p.stdout)

def main():
    roots=read(D/'roots.json');fields=['score','pv','nodes','completed_depth','has_result','stop_reason','bestmove','stats','fallback_move','fallback_pv'];checks=[]
    for root in roots:
        for name in ['base','pair']:
            opts=['--depth','16','--iterative','--max-nodes','12000'];old=run(root,name,opts,'shogi-lab-v0.11');new=run(root,name,opts)
            assert all(old[k]==new[k] for k in fields),(root['game'],name)
            checks.append({'game':root['game'],'variant':name})
    save(D/'search-invariance.json',{'checks':len(checks),'fields':fields,'rows':checks,'binarySha256':hashlib.sha256((R/'build/shogi-lab').read_bytes()).hexdigest()})
    root_sfens=[r['sfen'] for r in roots]
    with gzip.open(D/'base-leaf-sfens.json.gz','rt') as f:leaves=json.load(f)
    sfens=root_sfens+[leaves[i] for i in np.linspace(0,len(leaves)-1,128,dtype=int)]
    x=np.stack([full_features(s,base) for s in sfens]);parity={}
    for name,path in models.items():
        model=read_model(path);expected=head_score(x,model)
        p=subprocess.run([str(R/'build/shogi-lab'),'--eval-batch','--eval','nnue','--eval-model',str(path)],input='\n'.join(sfens)+'\n',capture_output=True,text=True,check=True)
        actual=np.array([json.loads(l)['score'] for l in p.stdout.splitlines()]);assert np.array_equal(actual,expected),name;parity[name]=len(sfens)
    limited=D/'trace-limit-test.jsonl';r=run(roots[0],'base',['--depth','16','--iterative','--max-nodes','12000','--leaf-trace',str(limited),'--trace-limit','5']);events=[json.loads(l) for l in limited.read_text().splitlines()]
    assert len(events)==5 and r['stats']['leaf_trace_omitted']>0
    normal=run(roots[0],'base',['--depth','16','--iterative','--max-nodes','12000']);stat=r['stats'].pop('leaf_trace_omitted');assert all(r[k]==normal[k] for k in fields)
    # Prespecified-model quality has already been inspected: diagnosis only.
    s=read(D/'summary.json');worst=max(s['quality']['12000-allCp']['comparisons']['pair-base']['details'],key=lambda d:d['deltaGapCp']);root=roots[worst['id']];out=[]
    for name in models:
        for depth in [2,3]:
            r=run(root,name,['--depth',str(depth),'--max-nodes','1000000']);assert r['complete'];out.append({'variant':name,'mode':'fixed_depth','depth':depth,'analysis':r})
    for nodes in [12000,12500,16000]:out.append({'variant':'pair','mode':'iterative','budget':nodes,'analysis':run(root,'pair',['--depth','16','--iterative','--max-nodes',str(nodes)])})
    save(D/'depth-diagnosis.json',{'selection':'post-hoc worst pair-v-base 12000-node teacher gap; not an independent test','root':root,'originalComparison':worst,'runs':out})
    save(D/'implementation-checks.json',{'integerParity':parity,'totalIndependentFeatureAndHeadChecks':len(sfens)*len(models),'oldNewSearchParity':len(checks),'traceLimit':{'kept':5,'omitted':stat,'transparent':True},'diagnosticRuns':len(out)})
    print((D/'implementation-checks.json').read_text())

if __name__=='__main__':main()
