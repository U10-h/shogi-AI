#!/usr/bin/env python3
"""Adversarial signed/unsigned SIMD and wrapping tests against the old kernel."""
import json,os,struct,subprocess,tempfile,random
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=R/'results/v0.15'
raw=(Path(os.environ.get('YANEURAOU_ASSETS',R.parent/'opponent'))/'yaneuraou.data').read_bytes()
ft=12+struct.unpack_from('<I',raw,8)[0]+4
network=ft+256*2+1710*256*2+4
w1=network+32*4;b2=w1+512*32;w2=b2+32*4;b3=w2+32*32;w3=b3+4
roots=json.loads((R/'results/v0.14/roots.json').read_text())
sfens=[r['sfen'] for r in roots[:8]]+['4k4/9/9/9/9/9/9/9/4K4 b - 1','4k4/9/9/9/9/9/9/9/4K4 b 18P4L4N4S4G2B2R 1']
rng=random.Random(2026092215);checks=0
with tempfile.TemporaryDirectory() as td:
 for case in range(8):
  data=bytearray(raw)
  if case<4:
   data[w1:b2]=bytes([127 if case%2 else 128])*(512*32)
   data[w2:b3]=bytes([127 if case//2 else 128])*(32*32)
  else:
   data[w1:b2]=rng.randbytes(512*32);data[w2:b3]=rng.randbytes(32*32)
  for start,count in [(network,32),(b2,32),(b3,1)]:
   for i in range(count):struct.pack_into('<i',data,start+4*i,rng.randint(-5000,5000))
  if case>=6:
   # Exercise modular 16-bit feature accumulation and model inventory changes.
   data[ft:ft+256*2+1710*256*2]=rng.randbytes(256*2+1710*256*2)
  path=Path(td)/f'{case}.nnue';path.write_bytes(data)
  outputs=[]
  for binary,mode in [('shogi-lab-v0.14','nnue'),('shogi-lab','nnue-scalar'),('shogi-lab','nnue-verify')]:
   p=subprocess.run([str(R/'build'/binary),'--eval-batch','--nnue-features','--eval',mode,'--eval-model',str(path)],input='\n'.join(sfens)+'\n',text=True,capture_output=True,check=True)
   outputs.append([(x['score'],x['h1']) for x in map(json.loads,p.stdout.splitlines())])
  assert outputs[0]==outputs[1]==outputs[2],case
  checks+=len(sfens)*2
out={'passed':True,'models':8,'positionsPerModel':len(sfens),'pairedChecks':checks,'compared':'score and all32 first-hidden activations; scalar,AVX2,old baseline'}
(D/'simd-extremes.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
