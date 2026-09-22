#!/usr/bin/env python3
"""Reproduce development occupancy and paired exact-optimization timing summaries."""
from pathlib import Path
import json,statistics as s,os
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V19_RESULTS',R/'results/v0.19'))
read=lambda p:json.loads(p.read_text())
rows=[r for p in (D/'dev').glob('*.json') for r in read(p)['runs']];out=[]
for variant in ['root','legacy','all8','all32','entry1','entry8']:
 a=[r for r in rows if r['variant']==variant];total=lambda key:sum(r['stats'].get(key,0) for r in a)
 out.append({'variant':variant,'roots':len(a),'meanNodes':s.mean(r['nodes'] for r in a),'meanIteration':s.mean(r['completed_depth'] for r in a),'meanEntries':s.mean(r['stats'].get('qtt_entries',0) for r in a),'meanPaths':s.mean(r['stats'].get('history_paths',0) for r in a),'fullCacheRoots':sum(r['stats'].get('qtt_entries',0)==100000 for r in a),'stores':total('qtt_stores'),'oneNodeStores':total('qtt_store_1'),'cutoffs':total('qtt_cutoffs'),'savedWorkEstimate':total('qtt_saved_work_estimate'),'cheapRejected':total('qtt_rejected_cheap'),'fullRejected':total('qtt_rejected_full')})
a=read(D/'overhead.json')['rows'];timings=[]
for i in sorted(set(r['id'] for r in a)):
 old=s.median(r['old']['elapsed_ms'] for r in a if r['id']==i);new=s.median(r['off']['elapsed_ms'] for r in a if r['id']==i)
 timings.append({'id':i,'oldMedianMs':old,'newMedianMs':new,'ratio':new/old})
metrics={'development':out,'exactOptimization':{'pairs':len(a),'nodeBudget':200000,'ratios':timings,'ratioOfMedianSums':sum(r['newMedianMs'] for r in timings)/sum(r['oldMedianMs'] for r in timings),'note':'Whole-build timing with cache disabled, not causal attribution of each changed instruction. Three repeats, eight roots; single environment.'},'sourceCommit':'6260f708db6a0e7ce40d059cbded47432b82945b'}
(D/'implementation-metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
print(json.dumps({'ratioOfMedianSums':metrics['exactOptimization']['ratioOfMedianSums']}))
