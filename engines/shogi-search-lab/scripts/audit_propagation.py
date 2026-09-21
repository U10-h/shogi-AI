#!/usr/bin/env python3
"""Validate cutoff certificates and PV endpoints; audit unsafe alternatives offline."""
import json
import subprocess
from benchmark_propagation import ROOT, BIN, OUT, CASES, analyze, signature

def load_events(path):
    events = [json.loads(line) for line in path.read_text().splitlines()]
    seen = {0}
    for e in events:
        for k in ['parent_id', 'cause_id', 'probe_cause_id']:
            if k in e: assert e[k] in seen, (k,e)
        assert e['event_id'] not in seen
        seen.add(e['event_id'])
    return events

def exact_scores(events):
    return {(e['depth'],e['move']):e['score'] for e in events if e['kind']=='root_exact'}

def main():
    traces=OUT/'traces'; traces.mkdir(exist_ok=True)
    certificate_count=exclusions=pvs=0
    audits=[]
    for case in CASES:
        full_path=traces/(case['id']+'-full-probe.jsonl')
        full=analyze(case,'full-probe',trace=full_path)[1]
        assert not full['trace_truncated']
        ev=load_events(full_path); scores=exact_scores(ev)
        probes={e['move']:e for e in ev if e['kind']=='assumption_probe'}
        deepest={m:v for (d,m),v in scores.items() if d==case['depth']}
        shallow={m:v for (d,m),v in scores.items() if d==1}
        best=max(deepest.values())
        ordered=sorted(deepest,key=lambda m:(-deepest[m],m))
        policies={
            'fewest_replies_keep5':sorted(probes,key=lambda m:(probes[m]['replies'],m))[:5],
            'depth1_keep5':sorted(shallow,key=lambda m:(-shallow[m],m))[:5],
            'depth1_margin200':[m for m in shallow if shallow[m]>=sorted(shallow.values(),reverse=True)[min(4,len(shallow)-1)]-200],
        }
        for name,kept in policies.items():
            missing=[m for m in ordered[:5] if m not in kept]
            loss=best-max(deepest[m] for m in kept)
            audits.append(dict(case=case['id'],policy=name,legal=len(deepest),retained=len(kept),
                               top5_missing=missing,best_value_loss=loss,
                               reference_best=ordered[0],reference_score=best,
                               retained_best=max(deepest[m] for m in kept)))
        for policy in ['screen','probe']:
            path=traces/(case['id']+'-'+policy+'.jsonl')
            result=analyze(case,policy,trace=path)[1]
            assert not result['trace_truncated'] and signature(result)==signature(full)
            events=load_events(path); by_id={e['event_id']:e for e in events}
            for e in events:
                if e['kind']!='top5_certificate': continue
                certificate_count+=1
                c=by_id[e['parent_id']]; it=by_id[c['parent_id']]
                move=c['move']; depth=it['depth']; witnesses=e['witnesses']
                assert len(witnesses)==5 and len({w['move'] for w in witnesses})==5
                assert all(scores[depth,w['move']]==w['score'] for w in witnesses)
                assert all(w['cause_id'] < e['event_id'] and by_id[w['cause_id']]['kind']=='root_exact'
                           and by_id[w['cause_id']]['move']==w['move']
                           and by_id[w['cause_id']]['score']==w['score'] for w in witnesses)
                assert move not in {w['move'] for w in witnesses}
                fifth=sorted(witnesses,key=lambda w:(-w['score'],w['move']))[-1]
                threshold=fifth['score']+(0 if move<fifth['move'] else 1)
                assert e['threshold']==threshold
                actual=scores[depth,move]; value=e['candidate_bound_value']
                if e['excluded']:
                    exclusions+=1
                    assert e['child_bound'] in ['lower','exact']
                    assert actual<=value<threshold, (case['id'],e,actual)
                else:
                    assert e['child_bound'] in ['upper','exact']
                    assert actual>=value>=threshold
            # Legally replay the returned line; depth0 reference adjudicates terminal first.
            for c in result['position']['candidates']:
                moves=case['moves']+c['pv']
                run=subprocess.run([str(BIN),'--sfen',case['initial'],'--moves',' '.join(moves),'--depth','0'],capture_output=True,text=True,check=True)
                end=json.loads(run.stdout); value=end['score']
                for _ in c['pv']:
                    value=-value
                    value=value-1 if value>90000 else value+1 if value< -90000 else value
                assert value==c['score'], (case['id'],c,value)
                pvs+=1
    # A small complete recursive event graph, with observed negamax/cutoff causes.
    sample=next(c for c in CASES if c['id']=='recapture-trap')
    detail=analyze(sample,'probe',trace=traces/'recursive-example.jsonl',recursive=True)[1]
    assert not detail['trace_truncated']
    detailed=load_events(traces/'recursive-example.jsonl')
    assert any(e['kind']=='negamax_backup' and e['cutoff'] for e in detailed)
    # Continuation of all five candidates with structural ordering enabled.
    reuse=[]
    case=CASES[0]
    first=analyze(case,'probe')[1]
    for rank,c in enumerate(first['position']['candidates'],1):
        commands=f"go depth 3\nadvance {c['move']}\ngo depth 3\nquit\n"
        events=analyze(case,'probe',commands=commands)
        advance,warm=events[2:4]
        cold_case=dict(case,moves=case['moves']+[c['move']])
        cold=analyze(cold_case,'full')[1]
        assert advance['reused_tree'] and advance['previous_rank']==rank
        assert advance['position']['root_id']==events[1]['position']['candidates'][rank-1]['node_id']
        assert signature(warm)==signature(cold)
        reuse.append(dict(rank=rank,move=c['move'],warm_nodes=warm['nodes'],cold_nodes=cold['nodes']))
    # Session trace ceiling is explicit, not silently interpreted as complete.
    tiny=OUT/'trace-limit-example.jsonl'
    args=[str(BIN),'--session','--trace',str(tiny),'--trace-limit','3']
    run=subprocess.run(args,input='go depth 1\nquit\n',text=True,capture_output=True,check=True)
    limit=json.loads(run.stdout.splitlines()[1])
    assert limit['trace_truncated'] and limit['trace_events']==3
    aggregate={name:dict(cases=sum(a['policy']==name for a in audits),
                        cases_losing_best_value=sum(a['policy']==name and a['best_value_loss']>0 for a in audits),
                        cases_missing_top5=sum(a['policy']==name and bool(a['top5_missing']) for a in audits)) for name in policies}
    report=dict(status='passed',certificates=certificate_count,proven_exclusions=exclusions,pv_endpoints=pvs,
                detailed_trace_events=len(detailed),retained_candidates=reuse,shadow_pruning=aggregate,shadow_cases=audits)
    (OUT/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='shadow_cases'},indent=2))

if __name__=='__main__': main()
