import test from 'node:test';
import assert from 'node:assert/strict';
import {START,positionAt,legalMoves,checkedPV} from '../dist/core.js';
import {lineEvidence} from '../dist/coach-analysis.js';
import {prepareTeaching,teachingReady,teachingComparison} from '../dist/teaching-lines.js';

function branch(root,id,pv,score=0){return {id,title:id,pv,score:{type:'cp',score,bound:false},depth:6,evidence:lineEvidence(root,pv)};}
function report(){const root={initial:START,moves:['7g7f','3c3d']},defense=branch(root,'defense',['2g2f','8c8d']);return {root,side:'black',chosen:'2g2f',bestMove:'2g2f',time:1000,best:{...defense,id:'best'},defense,replyExamples:[branch(root,'response-0',['2g2f','3a4b'],10),branch(root,'response-1',['2g2f','5a6b'],20)]};}
test('all distinct teaching scenarios reach seven plies through real searches with complete history',async()=>{
  const calls=[],r=report(),copy=structuredClone(r);
  const engine={async search(initial,moves,options){calls.push({initial,moves:[...moves],options});const p=positionAt(initial,moves),m=legalMoves(p)[0];return {infos:[{rank:1,type:'cp',score:999,depth:10,pv:[m.usi]}]};}};
  const result=await prepareTeaching(engine,r);assert(teachingReady(result));assert.equal(result.teaching.lines.length,3);
  for(const b of result.teaching.lines){assert.equal(b.pv.length,7);assert.equal(checkedPV(positionAt(r.root.initial,r.root.moves),b.pv).length,7);assert.equal(b.reading.segments.length,5);assert.notEqual(b.score.score,999,'endpoint evaluation never masquerades as the original root score');}
  assert.deepEqual(r,copy,'cached background report is not mutated');assert.deepEqual(calls[0].moves,[...r.root.moves,...r.defense.pv]);assert.equal(result.best.pv.length,7);
  assert(calls.every(c=>c.moves.slice(0,2).join(' ')==='7g7f 3c3d'));assert.match(teachingComparison(result),/差は小さい/);
});
test('a line ending in repetition is not padded, even when a legal-looking continuation follows it',async()=>{
  const initial='4k4/9/9/9/9/9/9/9/4K4 b - 1',cycle=['5i4i','5a4a','4i5i','4a5a'];
  const root={initial,moves:[...cycle,...cycle]},defense=branch(root,'defense',[...cycle,...cycle]);
  const result=await prepareTeaching({search(){assert.fail('terminal positions must not be searched');}},{root,side:'black',chosen:cycle[0],bestMove:cycle[0],best:defense,defense});
  assert.equal(result.defense.pv.length,4);assert.match(result.defense.reading.terminal,/千日手/);assert(teachingReady(result));
});
test('checkmate before seven plies is shown as the actual ending',async()=>{
  const root={initial:'3lkl3/3p1p3/4G4/9/9/9/9/9/K8 b G 1',moves:[]},defense=branch(root,'defense',['G*5b']);
  const result=await prepareTeaching({search(){assert.fail('mate must not be extended');}},{root,side:'black',chosen:'G*5b',bestMove:'G*5b',best:defense,defense});
  assert.equal(result.defense.pv.length,1);assert.match(result.defense.reading.terminal,/負け/);assert(teachingReady(result));
});
test('missing PVs remain explicitly incomplete; cancellation discards all additions',async()=>{
  const r=report(),incomplete=await prepareTeaching({async search(){return {infos:[]};}},r);
  assert(!teachingReady(incomplete));assert(incomplete.teaching.lines.every(b=>b.reading.unavailable&&b.pv.length===2));
  let cancelled=false,calls=0;const engine={async search(initial,moves){calls++;cancelled=true;return {infos:[{rank:1,pv:[legalMoves(positionAt(initial,moves))[0].usi]}]};}};
  await assert.rejects(prepareTeaching(engine,r,{check(){if(cancelled)throw new DOMException('cancel','AbortError');}}),{name:'AbortError'});
  assert.equal(calls,1);assert.equal(r.defense.pv.length,2);assert(!r.teaching);
});
