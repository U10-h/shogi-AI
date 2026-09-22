#!/usr/bin/env python3
import hashlib,json,statistics
from pathlib import Path
root=Path(__file__).resolve().parents[1];d=root/'results/v0.8'
speed=json.loads((d/'speed.json').read_text());q=json.loads((d/'quality.json').read_text());m=json.loads((d/'matches.json').read_text());v=json.loads((d/'verification.json').read_text())
assert q['status']==m['status']=='finished'
assert speed['modelSha256']==q['modelSha256']==m['modelSha256']==v['modelSha256']
assert q['protocolSha256']==m['protocolSha256']==hashlib.sha256((d/'protocol.json').read_bytes()).hexdigest()
assert speed['binarySha256']==q['binarySha256']==m['binarySha256']==hashlib.sha256((root/'build/shogi-lab').read_bytes()).hexdigest()
summary={'speed':speed['summary'],'quality':{},'qualityPairs':{'better':0,'equal':0,'worse':0},'matches':{},'verification':{k:value for k,value in v.items() if k!='searchRows'}}
for mode in ['positional','nnue']:
 a=[r for p in q['rows'] for r in p['runs'] if r['evaluation']==mode];assert len(a)==12
 summary['quality'][mode]={'roots':len(a),'meanCandidateGapCp':statistics.mean(r['teacherGap'] for r in a),'meanCompletedDepth':statistics.mean(r['completed_depth'] for r in a),'meanNodes':statistics.mean(r['nodes'] for r in a)}
for row in q['rows']:
 a={r['evaluation']:r['teacherGap'] for r in row['runs']};diff=a['nnue']-a['positional'];summary['qualityPairs']['better' if diff<0 else 'equal' if diff==0 else 'worse']+=1
for opponent in ['positional','yaneuraou']:
 games=[g for g in m['games'] if g['opponent']==opponent];a={'wins':0,'losses':0,'draws':0,'unresolved':0,'games':[]}
 for g in games:
  r=g['result'];label='unresolved' if r.get('unresolved') else 'draws' if r['winner'] is None else 'wins' if r['winner']==g['candidateSide'] else 'losses';a[label]+=1
  a['games'].append({'id':g['id'],'candidateSide':g['candidateSide'],'plies':len(g['moves']),'result':r})
 summary['matches'][opponent]=a
summary['speedReductionPercent']=100*(1-speed['summary']['nnue-lazy']['totalMs']/speed['summary']['nnue-full-eager']['totalMs'])
summary['adoptOptInNnue']=summary['qualityPairs']['better']>summary['qualityPairs']['worse'] and summary['matches']['positional']['wins']>summary['matches']['positional']['losses']
(d/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
