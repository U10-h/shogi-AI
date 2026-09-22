#!/usr/bin/env python3
import json,subprocess
import numpy as np
from prune_v13 import ROOT,D,M,BIN,BASE,run,read,save,policy
roots=read(D/'training-roots.json');checks={'feature_rows':0,'old_binary_parity':0,'zero_threshold_parity':0,'full_window_labels':0,'invalid_options':0}
value={'P':100,'L':300,'N':320,'S':450,'B':800,'R':1000,'G':550,'K':0,'+P':550,'+L':550,'+N':550,'+S':550,'+B':1000,'+R':1200}
def parse(sfen):
 board,side,hand,_=sfen.split();pieces={};hands={'b':0,'w':0}
 for rank,row in enumerate(board.split('/')):
  file=9;prom=''
  for c in row:
   if c.isdigit():file-=int(c)
   elif c=='+':prom='+'
   else:pieces[str(file)+chr(97+rank)]=prom+c;file-=1;prom=''
 count=''
 for c in hand:
  if c.isdigit():count+=c
  elif c!='-':hands['b' if c.isupper() else 'w']+=int(count or 1)*value[c.upper()]*.9;count=''
 return pieces,side,hands
for r in roots[::7]:
 rows=[json.loads(l) for l in (D/f"labels/{r['id']:03}.jsonl").open()]
 for row in rows[::max(1,len(rows)//20)]:
  pieces,side,hands=parse(row['sfen']);m=row['move'];captured=pieces[m[2:4]].upper();attacker=pieces[m[:2]].upper()
  gain=(value[captured]+value[captured[-1]])*.9;margin=(row['alpha']-row['stand']-gain)/900
  enemyking=next(s for s,p in pieces.items() if p==('k' if side=='b' else 'K'))
  distance=max(abs(int(m[2])-int(enemyking[0])),abs(ord(m[3])-ord(enemyking[1])))
  expected={0:1,1:np.clip((row['alpha']-row['stand'])/900,-8,8),2:np.clip(margin,-8,8),3:gain/1800,
   4:value[attacker]*.9/900,5:row['qleft']/6,6:min(row['index'],16)/16,9:int(distance<=2),10:min(hands['w' if side=='b' else 'b']/3600,4),
   11:min(hands[side]/3600,4),12:min(abs(row['stand'])/3600,4),13:np.clip(margin,0,8),14:int(captured[-1] in 'BR'),15:int(attacker=='K'),16:int(captured=='P')}
  assert all(abs(row['x'][k]-v)<1e-10 for k,v in expected.items()),(row,expected)
  assert row['improves']==int(row['parent_score_bound']>row['alpha'])
  checks['feature_rows']+=1
for r in roots[::10]:
 args=['--iterative','--depth',16,'--max-nodes',12000]
 base=run(r,args);old=run(r,args,ROOT/'build/shogi-lab-v0.12');zero=run(r,[*args,*policy('verified'),'--prune-probability',0])
 for field in ['score','pv','nodes','has_result','completed_depth','stop_reason','bestmove','fallback_move']:
  assert base[field]==old[field],(r['id'],field,'old');assert base[field]==zero[field],(r['id'],field,'zero')
 checks['old_binary_parity']+=1;checks['zero_threshold_parity']+=1
# Independent full-window child search checks the meaning/sign of censored labels.
# Fresh SFEN omits repetition ancestry; these small sampled cases must still agree.
for r in roots[::10]:
 row=json.loads(next((D/f"labels/{r['id']:03}.jsonl").open()))
 p=subprocess.run([str(BIN),'--sfen',row['sfen'],'--moves',row['move'],*BASE,'--depth','0','--qdepth',str(row['qleft']-1),'--max-nodes','1000000'],capture_output=True,text=True)
 assert p.returncode==0,p.stderr
 x=json.loads(p.stdout);assert int(-x['score']>row['alpha'])==row['improves'],(row,x)
 checks['full_window_labels']+=1
for args in [['--prune-policy','wrong'],['--prune-policy','verified','--prune-model',str(M/'alpha-risk.txt'),'--prune-probability','nan'],['--prune-policy','collect','--eval','material'],['--prune-audit'],['--prune-policy','verified','--prune-model',str(M/'alpha-risk.txt'),'--prune-probability','1']]:
 p=subprocess.run([str(BIN),*BASE,*args],capture_output=True,text=True);assert p.returncode==2,(args,p.stdout);checks['invalid_options']+=1
save(D/'implementation-checks.json',checks);print(checks)
