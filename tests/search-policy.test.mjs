import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchCoordinator,candidateFrontier,SEARCH_POLICY} from '../dist/search-policy.js';
import {SearchResults} from '../dist/search-results.js';
import {START,positionAt,legalMoves,hasLegalMove,statusOfRecord,recordAt,statusOf} from '../dist/core.js';
const info=(rank,depth,move)=>({rank,depth,pv:[move],type:'cp',score:100-rank,bound:false});
test('MultiPV ranking never mixes depths or repeats root moves',()=>{
  const batch=new SearchResults(3);
  for(const [rank,move]of [[1,'7g7f'],[2,'2g2f'],[3,'5i6h']])batch.add(info(rank,10,move));
  batch.add(info(1,11,'7g7f'));
  const same=batch.finish('7g7f');assert.deepEqual(same.map(i=>i.depth),[10,10,10]);
  batch.add(info(1,12,'2g2f'));
  const changed=batch.finish('2g2f');assert.equal(changed[0].pv[0],'2g2f');assert(changed.every(i=>i.bound));assert.equal(new Set(changed.map(i=>i.pv[0])).size,changed.length);
});
test('Cache preserves full history, search width, required effort and caller ownership',async()=>{
  let calls=0;
  const raw={async search(initial,moves){calls++;const p=positionAt(initial,moves);return {bestmove:legalMoves(p)[0].usi,infos:[info(1,10,legalMoves(p)[0].usi)]};},stop(){}};
  const c=new SearchCoordinator(raw),request=(moves=[],time=100,multipv=1)=>c.search(START,moves,{time,multipv});
  const first=await request();first.infos[0].score=99999;
  assert.notEqual((await request()).infos[0].score,99999);assert.equal(calls,1);
  await request([],200);await request([],200,3);assert.equal(calls,3);
  await c.search(START,[],{time:200,multipv:3,fresh:true});assert.equal(calls,4);
  const initial='4k4/9/9/9/9/9/9/9/4K4 b - 1',cycle=['5i4i','5a4a','4i5i','4a5a'];
  await c.search(initial,[],{time:100});await c.search(initial,cycle,{time:100});assert.equal(calls,6);
});
test('Stopped work is discarded rather than cached or handed to a later lesson',async()=>{
  let finish;const c=new SearchCoordinator({search:()=>new Promise(resolve=>{finish=resolve;}),stop(){}});
  const pending=c.search(START,[],{time:100});c.stop();finish({bestmove:'7g7f',infos:[info(1,10,'7g7f')]});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(c.cache.size,0);
});
test('Candidate frontier keeps learner moves and does not treat mate as centipawns',()=>{
  const r={chosen:'1g1f',bestMove:'7g7f',ranking:[info(1,10,'7g7f'),{...info(2,10,'2g2f'),type:'mate',score:5},info(3,10,'5i6h')]};
  const moves=candidateFrontier(r,SEARCH_POLICY);assert(moves.includes('1g1f'));assert(moves.includes('2g2f'));
});
test('Early legal-move exit and incremental records agree with full rule evaluation',()=>{
  for(const moves of [[],['7g7f','3c3d'],['7g7f','3c3d','8h2b+','3a2b']]){const p=positionAt(START,moves);assert.equal(hasLegalMove(p),legalMoves(p).length>0);assert.equal(statusOfRecord(recordAt(START,moves)),statusOf(START,moves));}
});
