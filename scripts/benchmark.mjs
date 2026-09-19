import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createNNUE} from './nnue-adapter.mjs';
import {investigate,reportBranches} from '../dist/coach-analysis.js';
import {prepareTeaching} from '../dist/teaching-lines.js';
import {positionAt,checkedPV} from '../dist/core.js';
const label=process.argv[2]||'baseline',all=process.argv.includes('--all'),legacy=process.argv.includes('--legacy'),time=Number(process.env.BENCH_TIME||180);
const modulePath=new URL('../dist/search-policy.js',import.meta.url),policy=!legacy&&existsSync(modulePath)?await import(modulePath):{};
const collectorPath=new URL('../dist/search-results.js',import.meta.url),collector=!legacy&&existsSync(collectorPath)?(await import(collectorPath)).SearchResults:null;
const engine=await createNNUE({collector,consideration:!!policy.SEARCH_POLICY?.consideration,pvInterval:policy.SEARCH_POLICY?.pvInterval||200}),rows=[];
try{
  const suite=JSON.parse(readFileSync(new URL('../docs/experiments/positions.json',import.meta.url))).positions;
  for(const p of (all?suite:suite.slice(0,3))){
    await engine.reset();const runner=policy.SearchCoordinator?new policy.SearchCoordinator(engine):engine;
    const start=performance.now();
    await runner.search(p.initial,p.moves,{time,multipv:3}); // background warm-up
    let r=await investigate(runner,{initial:p.initial,moves:p.moves},p.chosen,{time,rigor:'deep'});
    r=await prepareTeaching(runner,r,{time});
    const calls=engine.calls.slice(),elapsed=performance.now()-start,branches=reportBranches(r);
    for(const b of branches){if(checkedPV(positionAt(p.initial,p.moves),b.pv).length!==b.pv.length)throw Error('Illegal PV');if(b.pv.length<7&&!b.reading?.terminal)throw Error('Short teaching line');}
    const repeat=performance.now(),count=engine.calls.length;
    await runner.search(p.initial,p.moves,{time,multipv:3});
    const first=r.ranking.map(i=>i.pv[0]),ref=p.reference.infos.find(i=>i.pv[0]===r.bestMove);
    const row={id:p.id,ms:Math.round(elapsed),calls:calls.length,nodes:calls.reduce((s,c)=>s+c.nodes,0),coherentCalls:calls.filter(c=>c.coherent).length,candidates:r.verification.candidates.length,replies:r.verification.replies.length,rootCandidates:first.length,scenarios:branches.length,minPlies:Math.min(...branches.map(b=>b.pv.length)),best:r.bestMove,referenceMatch:r.bestMove===p.reference.bestmove,referenceGap:ref?.type==='cp'&&p.reference.infos[0]?.type==='cp'?p.reference.infos[0].score-ref.score:null,unstable:r.verification.unstable,depth:r.best.depth,repeatMs:Math.round(performance.now()-repeat),repeatCalls:engine.calls.length-count,trace:calls};rows.push(row);console.log(JSON.stringify({...row,trace:undefined}));
  }
  const diff=execFileSync('git',['diff','HEAD','--','dist','scripts'],{encoding:'utf8'});
  const out={label,date:new Date().toISOString(),environment:process.version+' linux WASM, 16 MiB hash, single thread',time,policy:policy.SEARCH_POLICY||null,sourceHash:createHash('sha256').update(diff).digest('hex'),rows};
  writeFileSync(new URL('../docs/experiments/'+label+'.json',import.meta.url),JSON.stringify(out,null,2));
}finally{engine.terminate();}
