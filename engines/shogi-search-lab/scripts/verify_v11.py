"""Acceptance checks for emergency USI output and experiment completeness."""
import json,subprocess,select,time,sys,hashlib
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=R/'results/v0.11';read=lambda p:json.loads(p.read_text())
if len(sys.argv)>1 and sys.argv[1]=='usi':
 case=read(D/'fallback/000.json');model=R.parent/'opponent/yaneuraou.data' if case['variant']=='base' else R/'build/models/v0.10/anchored50.nnue'
 p=subprocess.Popen([str(R/'build/shogi-lab'),'--usi','--preset','tactical','--eval','nnue','--eval-model',str(model)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 lines=[]
 def command(s,until):
  p.stdin.write(s+'\n');p.stdin.flush();start=time.monotonic()
  while time.monotonic()-start<30:
   # readline is bounded by a process watchdog on the whole test caller.
   line=p.stdout.readline().strip();lines.append(line)
   if line.startswith(until):return line
  raise RuntimeError('USI timeout')
 command('usi','usiok');command('isready','readyok')
 p.stdin.write('position startpos moves '+' '.join(case['prefix'])+'\n');p.stdin.flush()
 last=command('go nodes 12000','bestmove ')
 assert last=='bestmove '+case['run']['chosenMove'],(last,case['run']['chosenMove'])
 assert not any(' score ' in x for x in lines),lines
 assert any('completed_root_child' in x for x in lines)
 p.stdin.write('quit\n');p.stdin.flush();p.communicate(timeout=5)
 (D/'usi-fallback-test.json').write_text(json.dumps({'passed':True,'expected':case['run']['chosenMove'],'transcript':lines},indent=2)+'\n');print('USI fallback passed')
else:
 protocol=read(D/'protocol.json');assert hashlib.sha256((R/'build/shogi-lab').read_bytes()).hexdigest()==protocol['binarySha256']
 for name,expected in protocol['modelHashes'].items():
  model=R.parent/'opponent/yaneuraou.data' if name=='base' else R/f'build/models/v0.10/{name}.nnue'
  assert hashlib.sha256(model.read_bytes()).hexdigest()==expected
 roots=read(D/'roots.json');starts=read(D/'starts.json');games=[read(p) for p in (D/'matches').glob('*.json')];qs=[read(p) for p in (D/'quality').glob('*.json')];fs=[read(p) for p in (D/'fallback').glob('*.json')]
 assert len(games)==128;assert len(qs)==len(roots)+16;assert len(fs)==23;assert len(starts)==16
 from collections import Counter
 groups=Counter((g['level'],tuple(g['pair'])) for g in games)
 for level in ['short','long']:
  for pair in protocol['matches'][level]['pairs']:assert groups[(level,tuple(pair))]==protocol['matches'][level]['starts']*2
 assert all(g['status']=='finished' for g in games)
 plies=0;partial=0;first=0
 for g in games:
  for m in g['moves']:
   a=m['analysis'];assert a['nodes']<=g['nodes'];assert a['chosenMove']==m['usi'];assert a['fallback']==(not a['has_result']);assert a['chosenMove']==(a['bestmove'] if a['has_result'] else a['fallback_move'])
   assert not a['has_result'] or not a['fallback_pv'];plies+=1;partial+=a['fallback_source']=='completed_root_child';first+=a['fallback_source']=='first_legal'
 assert all(r['run']['fallback_source']=='completed_root_child' for r in fs)
 (D/'acceptance.json').write_text(json.dumps({'passed':True,'games':len(games),'qualityRows':len(qs),'historicalFallbackCases':len(fs),'plies':plies,'partialFallbacks':partial,'firstLegalFallbacks':first,'binaryAndModelProtocolPreserved':True},indent=2)+'\n')
 print((D/'acceptance.json').read_text())
