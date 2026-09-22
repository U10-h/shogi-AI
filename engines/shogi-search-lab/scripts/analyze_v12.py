"""Root comparisons, paired bootstrap, and visit-weighted leaf diagnostics."""
import csv,gzip,json,collections,hashlib,os,subprocess
from pathlib import Path
import numpy as np
from ml_nnue import full_features,read_model,head_score
R=Path(__file__).resolve().parents[1];D=R/'results/v0.12'
def read(p):return json.loads(p.read_text())
def save(p,x):p.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n')
def boot(rows):
    groups=collections.defaultdict(list)
    for key,v in rows:groups[str(key)].append(float(v))
    if not groups:return None
    a=np.array([[sum(v),len(v)] for v in groups.values()]);rng=np.random.default_rng(1212)
    samples=a[rng.integers(0,len(a),(5000,len(a)))].sum(1);values=samples[:,0]/samples[:,1]
    return {'mean':float(a[:,0].sum()/a[:,1].sum()),'ci95':np.percentile(values,[2.5,97.5]).tolist(),'clusters':len(a),'n':int(a[:,1].sum())}

def summary():
    roots=read(D/'roots.json');quality=[read(p) for p in sorted((D/'quality').glob('*.json'))]
    matches=[read(p) for p in sorted((D/'matches').glob('*.json'))]
    names=['base','pair','affine','anchored50','tempo40'];pairs=[('pair','base'),('pair','affine'),('pair','tempo40'),('affine','base'),('anchored50','tempo40')]
    out={'roots':len(roots),'qualityRows':len(quality),'searches':sum(len(r['runs']) for r in quality),'quality':{},'matches':{},'matchCount':len(matches)};csvrows=[]
    for budget in [12000,48000]:
        for label,predicate in [('allCp',lambda cs:all(c['type']=='cp' for c in cs)),('ordinaryCp',lambda cs:all(c['type']=='cp' and abs(c['score'])<8000 for c in cs))]:
            rows=[r for r in quality if predicate(r['candidates'])];stats={'n':len(rows),'excludedIds':[r['id'] for r in quality if r not in rows],'variants':{},'comparisons':{}}
            for name in names:
                gaps=[];depth=[];fallback=0
                for r in rows:
                    a=next(x for x in r['runs'] if x['variant']==name and x['budget']==budget);cs={c['move']:c['score'] for c in r['candidates']};gap=max(cs.values())-cs[a['chosenMove']]
                    gaps.append((r['root']['game'],gap));depth.append(a['completed_depth']);fallback+=a['fallback']
                    if label=='allCp':csvrows.append({'id':r['id'],'game':r['root']['game'],'nodes':budget,'variant':name,'move':a['chosenMove'],'candidateGapCp':gap,'completedDepth':a['completed_depth'],'fallback':a['fallback']})
                stats['variants'][name]={'gap':boot(gaps),'meanCompletedDepth':float(np.mean(depth)),'fallbacks':fallback}
            for a,b in pairs:
                values=[];same=0;details=[]
                for r in rows:
                    runs={x['variant']:x for x in r['runs'] if x['budget']==budget};cs={c['move']:c['score'] for c in r['candidates']};ma=runs[a]['chosenMove'];mb=runs[b]['chosenMove'];v=cs[mb]-cs[ma]
                    values.append((r['root']['game'],v));same+=ma==mb;details.append({'id':r['id'],'game':r['root']['game'],'deltaGapCp':v,'candidateMove':ma,'controlMove':mb,'candidateDepth':runs[a]['completed_depth'],'controlDepth':runs[b]['completed_depth']})
                stats['comparisons'][a+'-'+b]={'deltaGap':boot(values),'improved':sum(v<0 for _,v in values),'equal':sum(v==0 for _,v in values),'worse':sum(v>0 for _,v in values),'sameMove':same,'details':details}
            out['quality'][str(budget)+'-'+label]=stats
    # Same roots and same teacher candidate union: the budget comparison is paired.
    out['nodeBudgetComparison']={}
    for name in names:
        values=[]
        for r in quality:
            if not all(c['type']=='cp' for c in r['candidates']):continue
            cs={c['move']:c['score'] for c in r['candidates']};runs={a['budget']:a for a in r['runs'] if a['variant']==name}
            values.append((r['root']['game'],cs[runs[12000]['chosenMove']]-cs[runs[48000]['chosenMove']]))
        out['nodeBudgetComparison'][name]=boot(values)
    matchcsv=[]
    for budget in [12000,48000]:
        for a,b in [('pair','base'),('pair','affine')]:
            games=[g for g in matches if g['nodes']==budget and g['pair']==[a,b]];w=l=d=u=0;values=[];fallback=collections.Counter();plies=0
            for g in games:
                res=g['result'];win=res['winner'];is_u=res.get('unresolved',False)
                if is_u:u+=1;outcome='unresolved'
                else:
                    score=.5 if win is None else float(win==g['candidateSide']);values.append((g['root']['game'],score));w+=score==1;l+=score==0;d+=score==.5;outcome='draw' if score==.5 else 'win' if score==1 else 'loss'
                for m in g['moves']:fallback[m['variant']]+=m['fallback']
                plies+=len(g['moves']);matchcsv.append({'id':g['id'],'nodes':budget,'candidate':a,'control':b,'opening':g['root']['game'],'candidateSide':g['candidateSide'],'outcome':outcome,'plies':len(g['moves']),'reason':res['reason']})
            if games:out['matches'][f'{budget}-{a}-{b}']={'games':len(games),'wins':w,'losses':l,'draws':d,'unresolved':u,'resolvedScore':boot(values),'allGameScoreBounds':[(w+.5*d)/len(games),(w+.5*d+u)/len(games)],'fallbacks':dict(fallback),'plies':plies}
    save(D/'summary.json',out)
    for name,rows in [('quality-comparison.csv',csvrows),('match-comparison.csv',matchcsv)]:
        if rows:
            with (D/name).open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
    print(json.dumps({k:v for k,v in out.items() if k not in ['quality']},indent=2))

def leaves():
    model=read_model(Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data');heads={'base':model}
    for name,path in [('pair','v0.12/pair100.npz'),('affine','v0.12/affine-gap.npz'),('anchored50','v0.10/anchored50.npz'),('tempo40','v0.10/tempo40.npz')]:heads[name]=dict(np.load(R/'models'/path))
    files=sorted((D/'traces').glob('*.jsonl'));assert len(files)==32
    summary={'files':len(files),'traceGeometry':{},'baseReachedLeaves':{},'method':'Offline heads evaluated on the SAME base-reached non-check qeval visits; visit weighted, not independent samples. Frozen windows only; crossing counts are NOT actual alternative-search cutoffs.'};baseevents=[];sources=[]
    for p in files:
        events=[json.loads(line) for line in p.read_text().splitlines()];qeval={e['node']:e for e in events if e['event']=='qeval'};ret={e['node']:e for e in events if e['event']=='qreturn'}
        variant=p.stem.split('-')[1];g=summary['traceGeometry'].setdefault(variant,{'events':0,'qevals':0,'checked':0,'uncompletedQnodes':0,'reasons':collections.Counter(),'ply':collections.Counter()})
        g['events']+=len(events);g['qevals']+=len(qeval);g['checked']+=sum(e['checked'] for e in qeval.values());g['uncompletedQnodes']+=len(set(qeval)-set(ret));g['reasons'].update(e['reason'] for e in ret.values());g['ply'].update(e['ply'] for e in qeval.values())
        for e in qeval.values():
            if e['parent_qnode']:
                parent=qeval[e['parent_qnode']];assert parent['ply']+1==e['ply'] and parent['qleft']-1==e['qleft'] and parent['root_move']==e['root_move']
            assert (e['score'] is None)==e['checked']
        if variant=='base':
            for e in qeval.values():
                if e['score'] is not None:baseevents.append(e);sources.append(p.stem)
    sfens=list(dict.fromkeys(e['sfen'] for e in baseevents));lookup={s:i for i,s in enumerate(sfens)}
    run=subprocess.run([str(R/'build/shogi-lab'),'--eval-batch','--eval','nnue','--eval-model',str(Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'),'--nnue-features'],input='\n'.join(sfens)+'\n',text=True,capture_output=True,check=True)
    rows=[json.loads(l) for l in run.stdout.splitlines()];assert len(rows)==len(sfens)
    x=np.array([r['h1'] for r in rows],dtype=np.uint8);base=head_score(x,model);assert np.array_equal(base,np.array([r['score'] for r in rows]))
    for i in np.linspace(0,len(sfens)-1,128,dtype=int):assert np.array_equal(full_features(sfens[i],model),x[i])
    indices=np.array([lookup[e['sfen']] for e in baseevents]);ply=np.array([e['ply'] for e in baseevents]);qleft=np.array([e['qleft'] for e in baseevents]);beta=np.array([e['beta'] for e in baseevents])
    assert np.array_equal(base[indices],np.array([e['score'] for e in baseevents]))
    masks={'all':np.ones(len(indices),bool),'evenPly':ply%2==0,'oddPly':ply%2==1,'qdepthLimit':qleft<=0}
    out={'visits':len(indices),'uniqueSfens':len(sfens),'independentFeatureChecks':128,'integerBaseParity':len(sfens),'variants':{}}
    for name,head in heads.items():
        pred=head_score(x,head);delta=(pred[indices]-base[indices])/.9;v={}
        for label,mask in masks.items():v[label]={'n':int(mask.sum()),'meanCorrectionCp':float(delta[mask].mean()),'rmsCorrectionCp':float(np.sqrt(np.mean(delta[mask]**2))),'medianCorrectionCp':float(np.median(delta[mask]))}
        eligible=(qleft>0)&(abs(beta)<90000);orig=base[indices]>=beta;alternative=pred[indices]>=beta
        v['frozenWindowStandPat']={'eligible':int(eligible.sum()),'toCutoff':int((eligible&~orig&alternative).sum()),'awayFromCutoff':int((eligible&orig&~alternative).sum())};out['variants'][name]=v
    summary['baseReachedLeaves']=out;save(D/'leaf-summary.json',summary)
    np.savez_compressed(D/'base-leaf-features.npz',x=x,base=base,index=indices,ply=ply,qleft=qleft,beta=beta,source=np.array(sources),node=np.array([e['node'] for e in baseevents]))
    with gzip.open(D/'base-leaf-sfens.json.gz','wt') as f:json.dump(sfens,f)
    print(json.dumps(out,indent=2))

if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='leaves':leaves()
    else:summary()
