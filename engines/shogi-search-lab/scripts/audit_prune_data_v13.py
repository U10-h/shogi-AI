#!/usr/bin/env python3
"""Count position overlap without treating repeated visits as independent data."""
import json,collections
from prune_v13 import D,read,save
from ml_nnue import canonical
sets={k:set() for k in ['train','calibration','development']};visits=collections.Counter();missing={};games=collections.defaultdict(set)
for root in read(D/'training-roots.json'):
 p=D/f"labels/{root['id']:03}.jsonl";count=0
 for line in p.open():
  row=json.loads(line);sets[root['split']].add(' '.join(row['sfen'].split()[:3]));count+=1
 visits[root['split']]+=count;games[root['split']].add(root['game'])
 omitted=read(p.with_suffix('.json'))['analysis']['stats']['learned_eligible']-count
 assert 0<=omitted<96
 missing[root['id']]=omitted
canonical_sets={k:{canonical(s+' 1') for s in v} for k,v in sets.items()}
overlap={}
for a,b in [('train','calibration'),('train','development'),('calibration','development')]:
 overlap[a+'-'+b]=len(canonical_sets[a]&canonical_sets[b])
save(D/'data-audit.json',{'visits':dict(visits),'games':{k:len(v) for k,v in games.items()},'unique_raw_positions':{k:len(v) for k,v in sets.items()},
 'unique_canonical_positions':{k:len(v) for k,v in canonical_sets.items()},'shared_positions_including_mirrors':overlap,'uncompleted_child_labels_omitted':sum(missing.values()),
 'interpretation':'game split and root dedup do not necessarily separate every search descendant; overlaps are disclosed, not independent evidence; fresh final roots excluded all these parent positions'})
print(read(D/'data-audit.json'))
