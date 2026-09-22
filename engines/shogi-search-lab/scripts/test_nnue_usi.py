#!/usr/bin/env python3
import argparse,json,os,queue,re,subprocess,threading
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BIN=ROOT/'build/shogi-lab';MODEL=Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data'
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'results/v0.8/usi-verification.json');parser.add_argument('--preset',default='exact');config=parser.parse_args()
args=['--preset',config.preset,'--eval','nnue','--eval-model',str(MODEL)]
p=subprocess.Popen([str(BIN),'--usi',*args],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
q=queue.Queue();log=[]
def read():
 for line in p.stdout:q.put(line.rstrip())
threading.Thread(target=read,daemon=True).start()
def send(line):log.append('> '+line);p.stdin.write(line+'\n');p.stdin.flush()
def until(prefix):
 lines=[]
 while True:
  line=q.get(timeout=20);log.append('< '+line);lines.append(line)
  assert 'error' not in line,line
  if line.startswith(prefix):return lines
try:
 send('usi');assert any('var nnue' in l for l in until('usiok'))
 send('isready');until('readyok');send('position startpos')
 send('go depth 2');first=until('bestmove ')
 a=json.loads(subprocess.check_output([str(BIN),'--advanced',*args,'--depth','2','--iterative','--max-nodes','1000000000'],text=True))
 info=next(l for l in first if l.startswith('info depth '));score=int(re.search(r'score cp (-?\d+)',info)[1])
 assert score==int(a['score']*100/90);assert first[-1]=='bestmove '+a['bestmove']
 send('go movetime 1');until('bestmove ')
 send('setoption name Evaluation value positional')
 send('go depth 1');until('bestmove ')
 send('setoption name Evaluation value nnue')
 send('go infinite');send('stop');until('bestmove ')
 send('go depth 2');last=until('bestmove ')
 assert first[-1]==last[-1]
 assert re.search(r'score cp (-?\d+)',next(l for l in last if l.startswith('info depth ')))[1]==str(score)
 send('quit');p.wait(timeout=10);assert p.returncode==0
finally:
 if p.poll() is None:p.kill()
config.output.write_text(json.dumps({'passed':True,'cpConversion':True,'timeAbortAndStopRestore':True,'evaluationSwitch':True,'transcript':log},indent=2))
print('NNUE USI checks passed')
