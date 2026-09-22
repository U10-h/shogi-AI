#!/usr/bin/env python3
"""Compare selected moves against same-depth references and validate USI."""
import json, subprocess, threading, queue, time
from pathlib import Path
from benchmark_advanced import ROOT, OUT, BIN, run, dump

def audit():
    protocol=json.loads((ROOT/'experiments/v0.5-protocol.json').read_text())
    positions={p['id']:p for p in protocol['positions']}
    rows=[json.loads(x) for x in (OUT/'selective.jsonl').read_text().splitlines()]
    cache={};findings=[]
    for row in rows:
        r=row['result'];p=positions[row['position']]
        if not r['complete'] or not r['bestmove']:continue
        q='qsearch' in r.get('features',[])
        # Nominal depth is not comparable for RPS, but ordinary depth4 regret
        # still describes the value of its chosen move under a common reference.
        if r.get('driver') in ('rps','erps'):q=True
        key=(row['position'],q,r['bestmove'])
        rootkey=(row['position'],q,None)
        args=['--advanced','--preset','tactical' if q else 'exact','--max-nodes','1000000','--time-ms','10000']
        if rootkey not in cache:cache[rootkey]=run(p,args+['--depth','4'])
        if key not in cache:cache[key]=run({'initial':p['initial'],'moves':p['moves']+[r['bestmove']]},args+['--depth','3'])
        root,child=cache[rootkey],cache[key]
        score=-child['score'] if child['score'] is not None else None
        if score is not None:
            if score>90000:score-=1
            elif score< -90000:score+=1
        valid=root['complete'] and child['complete']
        findings.append({'position':row['position'],'variant':row['variant'],'reference':'qsearch-depth4' if q else 'fixed-depth4','compared':valid,'reported_score':r['score'],'reference_score':root['score'],'chosen_move':r['bestmove'],'chosen_move_reference_score':score,'regret':root['score']-score if valid else None,'reported_score_difference':r['score']-root['score'] if valid else None})
    summary={}
    for variant in sorted({r['variant'] for r in findings}):
        a=[r for r in findings if r['variant']==variant and r['compared']]
        summary[variant]={'compared':len(a),'nonoptimal_moves':sum(r['regret']>0 for r in a),'max_regret':max([r['regret'] for r in a],default=0),'different_reported_scores':sum(r['reported_score_difference']!=0 for r in a)}
    dump(OUT/'move-audit.json',{'rows':findings,'summary':summary,'note':'Extensions/RPS intentionally change horizon; regret is relative to this common reference, not game-theoretic truth.'})
    print('move audit complete',len(findings),flush=True)

def usi_test():
    p=subprocess.Popen([str(BIN),'--usi','--preset','tactical'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    messages=queue.Queue();log=[]
    def reader():
        for line in p.stdout:messages.put(line.rstrip())
    threading.Thread(target=reader,daemon=True).start()
    def send(s):p.stdin.write(s+'\n');p.stdin.flush()
    def expect(prefix,deadline=10):
        end=time.monotonic()+deadline
        while time.monotonic()<end:
            s=messages.get(timeout=max(.01,end-time.monotonic()));log.append(s)
            if s.startswith(prefix):return s
        raise RuntimeError('USI deadline')
    try:
        send('usi');expect('usiok');assert any('default tactical' in s for s in log)
        send('isready');expect('readyok');send('position startpos');send('go movetime 50');m=expect('bestmove').split()[1]
        assert m in run({'initial':json.loads((ROOT/'experiments/positions.json').read_text())['positions'][0]['initial'],'moves':[]},['--legal'])['moves']
        send('position startpos moves '+m);send('go infinite');time.sleep(.025);t=time.monotonic();send('stop');expect('bestmove',3);elapsed=time.monotonic()-t
        send('isready');expect('readyok')
        send('setoption name Preset value exact');send('setoption name MultiPV value 5');send('position startpos');start=len(log);send('go depth 2');expect('bestmove')
        assert all(any(f'multipv {i} ' in s for s in log[start:]) for i in range(1,6))
        send('setoption name MultiPV value 1');send('position sfen 3lkl3/3pGp3/4R4/9/9/9/9/9/K8 w - 1');send('go infinite');expect('info depth')
        # Search has already ended at this terminal position. Protocol still
        # requires bestmove to wait for stop; receiving it here is a failure.
        try:
            unexpected=messages.get(timeout=.1);raise AssertionError(unexpected)
        except queue.Empty:pass
        send('stop');assert expect('bestmove')=='bestmove resign'
        assert any('score mate -' in s for s in log)
        send('go mate 100');expect('checkmate notimplemented')
        send('quit');assert p.wait(timeout=5)==0
        dump(OUT/'usi-validation.json',{'passed':True,'stop_seconds':elapsed,'cases':['handshake','legal movetime','async stop','multipv5','infinite terminal waits for stop','mate score','mate command unsupported reply'],'messages':log})
    finally:
        if p.poll() is None:p.kill();p.wait()
    print('usi validation passed',flush=True)

def exact_move_audit():
    positions={p['id']:p for p in json.loads((ROOT/'experiments/v0.5-protocol.json').read_text())['positions']}
    rows=[json.loads(x) for x in (OUT/'exact.jsonl').read_text().splitlines()];cache={};findings=[]
    for row in rows:
        r=row['result'];p=positions[row['position']];key=(row['position'],r['bestmove'])
        if not r['complete'] or not r['bestmove']:continue
        if key not in cache:
            child=run({'initial':p['initial'],'moves':p['moves']+[r['bestmove']]},['--algorithm','minimax','--depth','2','--max-nodes','3000000'])
            assert child['complete'];score=-child['score']
            if score>90000:score-=1
            elif score< -90000:score+=1
            cache[key]=score
        findings.append({'position':row['position'],'variant':row['variant'],'repeat':row['repeat'],'move':r['bestmove'],'score':r['score'],'child_minimax_score':cache[key],'match':r['score']==cache[key]})
    dump(OUT/'exact-move-audit.json',{'checked':len(findings),'mismatches':sum(not r['match'] for r in findings),'unique_child_searches':len(cache),'rows':findings})
    assert all(r['match'] for r in findings)
    print('exact move audit passed',len(findings),flush=True)

if __name__=='__main__':audit();exact_move_audit();usi_test()
