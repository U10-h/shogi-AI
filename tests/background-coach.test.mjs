import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundCoach} from '../dist/background-coach.js';
import {newGame,positionAt,legalMoves} from '../dist/core.js';

const waitFor=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setImmediate(r));}assert.fail('Background work did not settle');};
function fixture(){
  const calls=[],reports=[],statuses=[];let release,hold=true;
  const engine={stop(){release?.();release=null;},async search(initial,moves,options){
    calls.push({moves:[...moves],...options});if(hold)await new Promise(r=>{release=r;});
    const p=positionAt(initial,moves),pv=[];for(let i=0;i<4;i++){const m=i===0&&!moves.length?p.createMoveByUSI('2g2f'):legalMoves(p)[0];if(!m)break;pv.push(m.usi);p.doMove(m);}
    return {bestmove:pv[0],infos:[{pv,rank:1,type:'cp',score:moves[0]==='7g7f'?600:0,bound:false,depth:8}]};
  }};
  const watcher=new BackgroundCoach(engine,{onReport:(r,m)=>reports.push({report:r,...m}),onStatus:s=>statuses.push(s)});
  return {watcher,calls,reports,statuses,release(){hold=false;release?.();release=null;}};
}
test('background review reuses the root prepared during thinking and confirms a loss before notifying',async()=>{
  const f=fixture(),g=newGame({thinkTime:1000}),root={initial:g.initial,moves:[]};
  f.watcher.update(g,{running:true,mode:'play'});assert.equal(f.calls.length,1);
  g.moves.push('7g7f');f.watcher.update(g,{running:true,mode:'play'});f.watcher.played(root,'7g7f');
  assert.equal(f.reports.length,0);f.release();await waitFor(()=>f.reports.length===1);
  assert.equal(f.calls.filter(c=>c.moves.length===0).length,1,'cached MultiPV root is reused');
  assert.equal(f.reports[0].concern,true);assert(f.reports[0].report.checkedAgain);
  assert.deepEqual(f.calls.slice(-2).map(c=>[c.time,c.multipv]),[[2000,1],[2000,1]]);
  await f.watcher.pause();
});
test('rapid play bounds the queue and a replaced game cannot receive an old report',async()=>{
  const f=fixture(),g=newGame();f.watcher.update(g,{running:true,mode:'play'});
  for(let i=0;i<12;i++){
    const root={initial:g.initial,moves:[...g.moves]},p=positionAt(g.initial,g.moves),m=legalMoves(p)[0];g.moves.push(m.usi);
    f.watcher.update(g,{running:true,mode:'play'});if(p.color===g.human)f.watcher.played(root,m.usi);
  }
  assert.equal(f.watcher.queue.length,2);assert(f.watcher.queue.every(t=>t.root.moves.length>=8));
  const next=newGame({clockMode:'match'});f.watcher.update(next,{running:true,mode:'play'});f.release();await f.watcher.pending;
  assert.equal(f.reports.length,0);assert.equal(f.watcher.queue.length,0);assert.equal(f.watcher.cache.size,0);
});
test('disabled coaching and an analysis failure leave no work loop running',async()=>{
  let calls=0;const statuses=[];
  const watcher=new BackgroundCoach({stop(){},async search(){calls++;throw Error('No memory');}},{onStatus:s=>statuses.push(s)});
  const g=newGame();g.backgroundCoaching=false;watcher.update(g,{running:true,mode:'play'});assert.equal(calls,0);
  g.backgroundCoaching=true;watcher.update(g,{running:true,mode:'play'});await watcher.pending;assert.equal(calls,1);assert(watcher.failed);
  watcher.update(g,{running:true,mode:'play'});assert.equal(calls,1);assert.match(statuses.at(-1),/対局は続けられます/);
  await watcher.pause();assert.equal(watcher.enabled,false);
});
test('pausing an idle watcher never stops a foreground consultation on its engine',async()=>{
  let stopped=0;const watcher=new BackgroundCoach({stop(){stopped++;}});
  await watcher.pause();assert.equal(stopped,0);
});
