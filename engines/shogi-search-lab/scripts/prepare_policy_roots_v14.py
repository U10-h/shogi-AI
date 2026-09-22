"""Final roots selected after frozen candidate choice, before opening outcomes."""
import json,hashlib
from pathlib import Path
from ml_nnue import canonical
R=Path(__file__).resolve().parents[1];D=R/'results/v0.14'
assert (D/'frozen.json').exists() and not (D/'roots.json').exists()
old={canonical(json.loads(s)['sfen']) for s in (R/'results/v0.10/labels.jsonl').read_text().splitlines()}
for version in ['v0.10','v0.11','v0.12','v0.13']:
 for p in (R/f'results/{version}/games').glob('*.json'):
  old.update(canonical(r['sfen']) for r in json.loads(p.read_text())['rows'])
original=len(old);roots=[];excluded=0;skipped=[]
for p in sorted((D/'games').glob('*.json')):
 g=json.loads(p.read_text());assert g['status']=='finished'
 eligible=[r for r in g['rows'] if r['ply']>=16 and not r['checked'] and all(c['type']=='cp' and abs(c['score'])<8000 for c in r['candidates']) and abs(r['candidates'][0]['score'])<=250]
 chosen=None
 for r in sorted(eligible,key=lambda r:(abs(r['offset']-24),r['offset'])):
  k=canonical(r['sfen'])
  if k in old:excluded+=1;continue
  chosen={**{k:r[k] for k in ['game','offset','ply','prefix','sfen']},'teacherOriginal':r['candidates'][0]};old.add(k);break
 if chosen:roots.append(chosen)
 else:skipped.append(g['id'])
assert len(list((D/'games').glob('*.json')))==24 and len(roots)>=16
(D/'roots.json').write_text(json.dumps(roots,indent=2)+'\n')
audit={'roots':len(roots),'skippedGames':skipped,'pastCanonicalPositions':original,'excludedRoots':excluded,'rootsSha256':hashlib.sha256((D/'roots.json').read_bytes()).hexdigest(),'rule':'one root per fresh trajectory; noncheck, abs teacher depth6 cp<=250, ply>=16; nearest offset24; exact/mirror prior corpus excluded','limitation':'opening families shared; no assertion all descendant positions unseen'}
(D/'root-audit.json').write_text(json.dumps(audit,indent=2)+'\n');print(audit)
