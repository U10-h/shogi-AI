"""Choose fresh balanced test roots using teacher data only, before outcomes."""
import json,hashlib
from pathlib import Path
from ml_nnue import canonical
R=Path(__file__).resolve().parents[1];D=R/'results/v0.12'
def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
assert not (D/'roots.json').exists(),'Do not redefine a test set after opening results'
old={canonical(json.loads(s)['sfen']) for s in (R/'results/v0.10/labels.jsonl').read_text().splitlines()}
for p in (R/'results/v0.11/games').glob('*.json'):
    old.update(canonical(r['sfen']) for r in json.loads(p.read_text())['rows'])
roots=[];skipped=[];excluded=0;ids=[]
for p in sorted((D/'games').glob('*.json')):
    g=json.loads(p.read_text());assert g['status']=='finished';ids.append(g['id'])
    eligible=[r for r in g['rows'] if r['ply']>=16 and not r['checked'] and all(c['type']=='cp' and abs(c['score'])<8000 for c in r['candidates']) and abs(r['candidates'][0]['score'])<=250]
    chosen=None
    for r in sorted(eligible,key=lambda r:(abs(r['offset']-24),r['offset'])):
        k=canonical(r['sfen'])
        if k in old:excluded+=1;continue
        chosen={**{k:r[k] for k in ['game','offset','ply','prefix','sfen']},'teacherOriginal':r['candidates'][0]};old.add(k);break
    if chosen:roots.append(chosen)
    else:skipped.append(g['id'])
assert ids==list(range(24)) and len(roots)>=8
save(D/'roots.json',roots)
save(D/'root-audit.json',{'collectedGames':24,'roots':len(roots),'skippedGames':skipped,'overlapExclusions':excluded,
                        'scoreRangeCp':[min(r['teacherOriginal']['score'] for r in roots),max(r['teacherOriginal']['score'] for r in roots)],
                        'selectionBeforeOutcomes':True,'rootsSha256':hashlib.sha256((D/'roots.json').read_bytes()).hexdigest()})
print((D/'root-audit.json').read_text())
