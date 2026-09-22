#!/usr/bin/env python3
"""Symmetry, independent dot-product, old-engine equivalence, search and input guards."""
import json,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BIN=ROOT/'build/shogi-lab'
def call(args,bin=BIN):
    p=subprocess.run([str(bin),*args],text=True,capture_output=True)
    assert p.returncode in (0,3),(args,p.stderr)
    return json.loads(p.stdout)
def transform(sfen,rotate=False):
    board,side,hand,ply=sfen.split();rows=[]
    for row in board.split('/'):
        a=[];promote=''
        for c in row:
            if c.isdigit():a+=['']*int(c)
            elif c=='+':promote='+'
            else:a.append(promote+c);promote=''
        rows.append(a)
    if rotate:rows=rows[::-1]
    out=[]
    for row in rows:
        s='';empty=0
        for cell in row[::-1]:
            if not cell:empty+=1;continue
            if empty:s+=str(empty);empty=0
            s+=cell.swapcase() if rotate else cell
        if empty:s+=str(empty)
        out.append(s)
    return '/'.join(out)+' '+(('w' if side=='b' else 'b') if rotate else side)+' '+(hand.swapcase() if rotate else hand)+' '+ply
data=json.loads((ROOT/'results/v0.7/training-games.json').read_text())
sfens=[r['sfen'] for g in data['games'] for r in g['rows'][::8]]
sfens+=['4k4/9/P8/9/9/9/9/9/4K4 b - 1','k3r4/9/9/9/9/9/4G4/9/4K4 b P 1']
triples=[s for f in sfens for s in [f,transform(f),transform(f,True)]]
summary={'symmetryPositions':len(sfens),'modes':{},'baselineComparisons':0,'searchComparisons':0}
for mode in ['material','positional','learned']:
    extra=['--eval-model',str(ROOT/'experiments/positional-v0.7.txt')] if mode=='learned' else []
    p=subprocess.run([str(BIN),'--eval-batch','--eval',mode,*extra],input='\n'.join(triples)+'\n',text=True,capture_output=True,check=True)
    lines=[json.loads(x) for x in p.stdout.splitlines()]
    for i in range(0,len(lines),3):
        a,b,c=lines[i:i+3]
        assert a['features']==b['features']
        assert a['features']==[-v for v in c['features']]
        assert a['score']==b['score']==c['score']
        for j,row in enumerate([a,b,c]):
            import math
            correction=max(-1500,min(1500,sum(x*w for x,w in zip(row['features'],row['weights']))))
            correction=math.floor(correction+.5) if correction>=0 else math.ceil(correction-.5)
            expected=row['material']+(1 if triples[i+j].split()[1]=='b' else -1)*correction
            assert row['score']==(row['material'] if mode=='material' else expected)
    summary['modes'][mode]={'featureAndScoreSymmetry':True,'independentDotProduct':True}
for s in sfens[::7]:
    common=['--advanced','--preset','exact','--sfen',s,'--depth','2','--max-nodes','10000000']
    old=call(common,ROOT/'build/shogi-lab-v0.6');new=call(common+['--eval','material'])
    for k in ['score','bestmove','nodes','pv']:assert old[k]==new[k],k
    summary['baselineComparisons']+=1
    for mode in ['positional','learned']:
        extra=['--eval-model',str(ROOT/'experiments/positional-v0.7.txt')] if mode=='learned' else []
        common2=common+['--eval',mode,*extra,'--multipv','5']
        a=call(common2+['--driver','ab']);b=call(common2+['--driver','pvs'])
        assert a['complete'] and b['complete']
        assert a['score']==b['score']
        assert [(c['score'],c['pv'][0]) for c in a['candidates']]==[(c['score'],c['pv'][0]) for c in b['candidates']]
        summary['searchComparisons']+=1
for args in [ ['--advanced','--eval','garbage'],['--advanced','--eval','learned'],['--advanced','--eval','positional','--features','probcut','--probcut-model','experiments/probcut-v0.5.txt'],['--session','--eval','positional'] ]:
    p=subprocess.run([str(BIN),*args],cwd=ROOT,capture_output=True);assert p.returncode==2
with tempfile.TemporaryDirectory() as d:
    for content in ['shogi-lab-positional-v1 38\nking_advance_squared nan\n','shogi-lab-positional-v1 38\nking_advance_squared 501\n']:
        path=Path(d)/'invalid.txt';path.write_text(content)
        p=subprocess.run([str(BIN),'--advanced','--eval','learned','--eval-model',str(path)],capture_output=True);assert p.returncode==2
summary['passed']=True
(ROOT/'results/v0.7/eval-verification.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
