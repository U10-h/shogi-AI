#!/usr/bin/env python3
"""Game split and symmetry-aware dedup before feature extraction; no test scoring."""
import hashlib,json,os,subprocess
from pathlib import Path
import numpy as np
from ml_nnue import canonical,read_model,full_features,head_score
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.10';MODEL=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'
games=[json.loads(p.read_text()) for p in sorted((D/'games-final').glob('*.json'))]
assert len(games)==192 and all(g['status']=='finished' for g in games)
priority={'train':0,'validation':1,'test':2};kept={};raw=0;reject={'mate_or_extreme':0,'early':0,'overlap':0}
roots={'validation':[],'test':[]}
for g in games:
    root_candidates=[]
    for r in g['rows']:
        c0=r['candidates'][0]
        if r['ply']<12:reject['early']+=1;continue
        if not r['checked'] and c0['type']=='cp' and abs(c0['score'])<3000:root_candidates.append(r)
        variants=[('root',r['sfen'],r['checked'],c0,1,0)]+[('child',c['childSfen'],c['childChecked'],c,-1,c['rank']) for c in r['candidates']]
        for source,sfen,checked,c,sign,rank in variants:
            raw+=1
            if c['type']!='cp' or abs(c['score'])>=8000:reject['mate_or_extreme']+=1;continue
            key=canonical(sfen)
            row={'game':g['id'],'split':g['split'],'sfen':sfen,'checked':checked,'source':source,'rank':rank,'ply':r['ply']+(source=='child'),'teacherDepth':c['depth']-(source=='child'),'targetRaw':sign*c['score']*.9,'rootId':f"{g['id']}:{r['offset']}",'firstMove':c['pv'][0]}
            if key in kept:
                reject['overlap']+=1;old=kept[key]
                if (priority[row['split']],row['teacherDepth'])<=(priority[old['split']],old['teacherDepth']):continue
            kept[key]=row
    if g['split'] in roots:
        assert len(root_candidates)>=6
        fractions=[.2,.5,.8] if g['split']=='test' else [[.2,.5,.8][g['id']%3]]
        for f in fractions:
            r=root_candidates[min(len(root_candidates)-1,int(len(root_candidates)*f))]
            roots[g['split']].append({'game':g['id'],'offset':r['offset'],'ply':r['ply'],'sfen':r['sfen'],'prefix':g['opening']+[x['selected'] for x in g['rows'][:r['offset']]],'teacherOriginal':r['candidates'][0]})
rows=list(kept.values())
# Evaluation roots are protected as well as the labeled child positions.
protected={s:{canonical(r['sfen']) for r in rr} for s,rr in roots.items()}
rows=[r for r in rows if not (r['split']=='train' and canonical(r['sfen']) in protected['validation']|protected['test']) and not (r['split']=='validation' and canonical(r['sfen']) in protected['test'])]
keys={s:{canonical(r['sfen']) for r in rows if r['split']==s} for s in priority}
assert not keys['train']&keys['validation'] and not keys['train']&keys['test'] and not keys['validation']&keys['test']
cmd=[str(ROOT/'build/shogi-lab'),'--eval-batch','--eval','nnue','--eval-model',str(MODEL),'--nnue-features']
run=subprocess.run(cmd,input='\n'.join(r['sfen'] for r in rows)+'\n',capture_output=True,text=True,check=True)
features=[json.loads(line) for line in run.stdout.splitlines()];assert len(features)==len(rows)
for row,f in zip(rows,features):assert bool(row['checked'])==f['in_check']
x=np.array([f['h1'] for f in features],dtype=np.uint8);base=np.array([f['score'] for f in features],dtype=np.int32)
model=read_model(MODEL);assert np.array_equal(head_score(x,model),base)
indices=np.linspace(0,len(rows)-1,min(1024,len(rows)),dtype=int)
for i in indices:assert np.array_equal(full_features(rows[i]['sfen'],model),x[i]),i
np.savez_compressed(D/'dataset.npz',x=x,base=base,target=np.array([r['targetRaw'] for r in rows]),split=np.array([r['split'] for r in rows]),game=np.array([r['game'] for r in rows]),ply=np.array([r['ply'] for r in rows]),checked=np.array([r['checked'] for r in rows]),source=np.array([r['source'] for r in rows]))
(D/'labels.jsonl').write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows))
for split,rr in roots.items():(D/f'{split}-roots.json').write_text(json.dumps(rr,indent=2)+'\n')
summary={'games':len(games),'teacherSearchRoots':sum(len(g['rows']) for g in games),'rawLabelsAfterEarlyFilter':raw,'kept':len(rows),'removed':reject,'splits':{s:{'labels':sum(r['split']==s for r in rows),'quietLabels':sum(r['split']==s and not r['checked'] for r in rows),'games':sum(g['split']==s for g in games)} for s in priority},'crossSplitOverlapAfterSymmetryDedup':0,'independentFeatureChecks':len(indices),'headScoreMatches':len(rows),'datasetSha256':hashlib.sha256((D/'dataset.npz').read_bytes()).hexdigest(),'roots':{s:len(rr) for s,rr in roots.items()},'gamesWithTerminal':sum(g['terminal'] is not None for g in games)}
(D/'dataset-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
