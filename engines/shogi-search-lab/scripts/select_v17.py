#!/usr/bin/env python3
import json,statistics
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'results/v0.17';out={}
for p in sorted((D/'dev').glob('*.json')):
 r=json.loads(p.read_text());cs=json.loads((D/'dev-teacher'/f"{r['root']['id']}.json").read_text())['candidates']
 if any(c['type']!='cp' or abs(c['score'])>=30000 for c in cs):continue
 scores={c['move']:c['score'] for c in cs};best=max(scores.values())
 for a in r['runs']:out.setdefault(a['variant'],[]).append({'gap':best-scores[a['chosenMove']],'nps':a['nodes']/a['elapsed_ms']*1000,'pv':len(a['pv']),'has':a['has_result']})
summary={k:{'meanGap':statistics.mean(x['gap'] for x in v),'n':len(v),'completed':sum(x['has'] for x in v),'nps':statistics.mean(x['nps'] for x in v),'pv':statistics.mean(x['pv'] for x in v)} for k,v in out.items()}
priority=['root','all','cost','roundrobin','puct','halving','reliability']
selected=min(priority,key=lambda k:(summary[k]['meanGap'],priority.index(k)))
result={'criterion':'minimum development common-candidate teacher gap at 0.3 and 1 seconds; fixed priority order breaks ties','selected':selected,'testVariants':list(dict.fromkeys(['baseline','adaptive','root',selected])),'dev':summary}
(D/'selection.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
