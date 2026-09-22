#!/usr/bin/env python3
"""Integer Python/C++ parity and full/incremental search parity for trained heads."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
import numpy as np
from ml_nnue import read_model,head_score,export_model
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.10';BIN=ROOT/'build/shogi-lab';BASE=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'
p=argparse.ArgumentParser();p.add_argument('models',nargs='+');args=p.parse_args()
data=np.load(D/'dataset.npz',allow_pickle=False);labels=[json.loads(s) for s in (D/'labels.jsonl').read_text().splitlines()]
# Validation/train only, leaving candidate test metrics untouched.
available=np.flatnonzero(data['split']!='test');indices=available[np.linspace(0,len(available)-1,1024,dtype=int)]
text='\n'.join(labels[i]['sfen'] for i in indices)+'\n';summary={'models':{},'binarySha256':hashlib.sha256(BIN.read_bytes()).hexdigest()}
base=read_model(BASE)
def search(model,mode,sfen,**limits):
    cmd=[str(BIN),'--advanced','--preset','tactical','--eval',mode,'--eval-model',str(model),'--sfen',sfen,'--depth','3','--max-nodes','16000']
    p=subprocess.run(cmd,capture_output=True,text=True);assert p.returncode in [0,3],p.stderr;return json.loads(p.stdout)
for name in args.models:
    model=ROOT/'build/models/v0.10'/(name+'.nnue');head=dict(np.load(ROOT/'models/v0.10'/(name+'.npz'),allow_pickle=False));sha=export_model(base,head,model)
    expected=head_score(data['x'][indices],head)
    mode_counts={}
    for mode in ['nnue','nnue-full','nnue-verify']:
        p=subprocess.run([str(BIN),'--eval-batch','--eval',mode,'--eval-model',str(model)],input=text,text=True,capture_output=True,check=True)
        actual=np.array([json.loads(line)['score'] for line in p.stdout.splitlines()]);assert np.array_equal(actual,expected),name
        mode_counts[mode]=len(actual)
    searches=[]
    for i in indices[::128]:
        a=search(model,'nnue-full',labels[i]['sfen']);b=search(model,'nnue-verify',labels[i]['sfen'])
        for k in ['score','bestmove','pv','nodes','completed_depth','stop_reason']:assert a[k]==b[k],(name,k)
        searches.append({'sfen':labels[i]['sfen'],'nodes':b['nodes'],'complete':b['complete'],'verifiedUpdates':b['stats'].get('nnue_verified',0)})
    summary['models'][name]={'sha256':sha,'staticExactMatches':mode_counts,'searchComparisons':searches}
# Adding a feature-export API must not alter baseline inference/search.
summary['legacyComparisons']=0
for i in indices[::128]:
    sfen=labels[i]['sfen'];new=search(BASE,'nnue',sfen)
    cmd=[str(ROOT/'build/shogi-lab-v0.9'),'--advanced','--preset','tactical','--eval','nnue','--eval-model',str(BASE),'--sfen',sfen,'--depth','3','--max-nodes','16000'];p=subprocess.run(cmd,text=True,capture_output=True);assert p.returncode in [0,3];old=json.loads(p.stdout)
    for k in ['score','bestmove','pv','nodes','completed_depth','stop_reason']:assert old[k]==new[k]
    summary['legacyComparisons']+=1
summary['passed']=True;(D/('verification-'+'-'.join(args.models)+'.json')).write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({'passed':True,'models':args.models,'staticPositionsPerMode':len(indices),'legacyComparisons':summary['legacyComparisons']}))
