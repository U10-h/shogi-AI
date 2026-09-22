#!/usr/bin/env python3
"""Independent upstream score oracle, incremental refresh parity, and search ablations."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BIN=ROOT/'build/shogi-lab'
MODEL=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'
def call(args):
 p=subprocess.run([str(BIN),*args],capture_output=True,text=True)
 assert p.returncode in (0,3),(args,p.stderr)
 return json.loads(p.stdout)
data=json.loads((ROOT/'results/v0.7/matches.json').read_text())
sfens=list(dict.fromkeys(s for g in data['games'] for r in g['moves'] for s in (r['beforeSfen'],r['afterSfen'])))
sfens+=['4k4/9/P8/9/9/9/9/9/4K4 b - 1','k3r4/9/9/9/9/9/4G4/9/4K4 b P 1','4k4/9/9/9/9/9/9/9/4K4 b 18P4L4N4S4G2B2R 1','4k4/9/9/9/9/9/9/9/4K4 w 18p4l4n4s4g2b2r 1']
text='\n'.join(sfens)+'\n'
oracle=subprocess.run([str(ROOT/'build/nnue-oracle'),str(MODEL)],input=text,capture_output=True,text=True,check=True)
expected=[int(x) for x in oracle.stdout.splitlines()];assert len(expected)==len(sfens)
summary={'modelSha256':hashlib.sha256(MODEL.read_bytes()).hexdigest(),'oraclePositions':len(sfens),'staticModes':{},'searchComparisons':0,'verifiedAccumulatorUpdates':0,'legacyComparisons':0,'malformedModelsRejected':0,'searchRows':[]}
for mode in ['nnue-full','nnue','nnue-verify']:
 p=subprocess.run([str(BIN),'--eval-batch','--eval',mode,'--eval-model',str(MODEL)],input=text,capture_output=True,text=True,check=True)
 got=[json.loads(x)['score'] for x in p.stdout.splitlines()]
 assert len(got)==len(expected)
 for i,(a,b) in enumerate(zip(got,expected)):assert a==b,(i,sfens[i],a,b)
 summary['staticModes'][mode]={'exactMatches':len(got),'maxError':0}
# Include early/middle/late play, drops/promotions and constructed check evasions.
samples=[sfens[i] for i in [0,15,35,60,90,130,220,300]]+sfens[-4:-2]
for s in samples:
 for preset in ['exact','tactical','selective']:
  common=['--advanced','--preset',preset,'--sfen',s,'--depth','3','--qdepth','2','--max-nodes','30000','--eval-model',str(MODEL)]
  a=call(common+['--eval','nnue-full','--eager-eval'])
  b=call(common+['--eval','nnue-verify'])
  for k in ['score','bestmove','pv','nodes','completed_depth','stop_reason']:assert a[k]==b[k],(preset,k,a[k],b[k])
  summary['searchComparisons']+=1;summary['verifiedAccumulatorUpdates']+=b['stats'].get('nnue_verified',0)
  summary['searchRows'].append({'preset':preset,'sfen':s,'nodes':b['nodes'],'complete':b['complete'],'stats':b['stats']})
 for mode in ['material','positional']:
  args=['--advanced','--preset','tactical','--sfen',s,'--depth','2','--eval',mode,'--max-nodes','10000000']
  old=subprocess.run([str(ROOT/'build/shogi-lab-v0.7'),*args],capture_output=True,text=True,check=True)
  a=json.loads(old.stdout);b=call(args)
  for k in ['score','bestmove','pv','nodes']:assert a[k]==b[k],k
  summary['legacyComparisons']+=1
with tempfile.TemporaryDirectory() as d:
 original=MODEL.read_bytes()
 cases=[b'',original[:100],b'BAD!'+original[4:],original+b'X',original[:173]+b'BAD!'+original[177:]]
 for i,data in enumerate(cases):
  f=Path(d)/str(i);f.write_bytes(data)
  p=subprocess.run([str(BIN),'--advanced','--eval','nnue','--eval-model',str(f)],capture_output=True)
  assert p.returncode==2;summary['malformedModelsRejected']+=1
summary['passed']=True
(ROOT/'results/v0.8/verification.json').write_text(json.dumps(summary,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k!='searchRows'},indent=2))
