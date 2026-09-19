import test from 'node:test';
import assert from 'node:assert/strict';
import {START,newGame,validateGame,rewindGame,forwardGame,forkHistory,positionAt} from '../dist/core.js';
import {readingOutcome,readingReason} from '../dist/reading.js';
import {reviewTargets,reviewPast} from '../dist/retrospective.js';

test('undo / redo keeps the full line, clocks and terminal result across reload',()=>{
  let g=newGame();g.moves=['7g7f','3c3d','2g2f','8c8d'];g.result='時間切れ';
  g.clockHistory=[{black:598000,white:600000},{black:598000,white:599000},{black:596000,white:599000},{black:596000,white:597000}];g.clocks={black:0,white:597000};
  const original=structuredClone(g);assert(rewindGame(g,3));assert.equal(g.result,null);assert(rewindGame(g,0));
  g=validateGame(JSON.parse(JSON.stringify(g)));for(let i=0;i<4;i++)assert(forwardGame(g));
  assert.deepEqual(g.moves,original.moves);assert.deepEqual(g.clocks,original.clocks);assert.deepEqual(g.clockHistory,original.clockHistory);assert.equal(g.result,original.result);assert.equal(g.redo,null);assert(!forwardGame(g));
});
test('a new continuation archives the original future; malformed redo data is rejected',()=>{
  const g=newGame();g.moves=['7g7f','3c3d'];rewindGame(g,0);
  const broken=structuredClone(g);broken.redo.moves=['7g7a'];assert.throws(()=>validateGame(broken));
  forkHistory(g);g.moves.push('2g2f');assert(!forwardGame(g));assert.deepEqual(g.variations[0].moves,['7g7f','3c3d']);
  assert.equal(positionAt(g.initial,g.moves).color,'white');
});
test('the displayed outcome includes recaptures, promotion and the correct learner side',()=>{
  const root={initial:START,moves:['7g7f']},branch={pv:['3c3d','8h2b+','3a2b']};
  const beforeRecapture=readingOutcome(root,branch,'black',2),after=readingOutcome(root,branch,'black',3);
  assert.deepEqual(beforeRecapture.gains,['角1枚']);assert.deepEqual(after.gains,[]);assert.deepEqual(after.losses,[]);
  assert.match(after.balance,/取り返しまで含めると開始時と同じ/);assert.match(readingOutcome(root,branch,'white',2).balance,/後手.*角1枚減っています/);
  assert.equal(after.position.sfen,positionAt(START,[...root.moves,...branch.pv]).sfen);
  const reason=readingReason({root,side:'white',defense:branch});assert.match(reason,/相手の２二角成に２二銀/);assert.doesNotMatch(reason,/利きが広がる/);
});
test('retrospective points to the earlier loss of opportunity, not a later best defense',async()=>{
  const g=newGame();g.moves=['7g7f','3c3d','2g2f','8c8d','2f2e','8d8e'];
  const window=reviewTargets(g);assert.deepEqual(window.targets.map(x=>x.ply),[1,3,5]);
  const cached=t=>({time:2000,chosen:t.played,bestMove:t.played,checkedAgain:true,best:{score:{type:'cp',score:t.ply===1?-50:-700}},defense:{score:{type:'cp',score:t.ply===1?-750:-710}}});
  const r=await reviewPast({search(){assert.fail('cached results should be reused');}},g,{time:1000,cached});
  assert.equal(r.suspect.ply,1);assert.equal(r.items.at(-1).grade,'resilient');
  assert.deepEqual(reviewTargets({...g,human:'white'},{before:4,plies:2}).targets.map(t=>t.ply),[4]);
  let checks=0;await assert.rejects(reviewPast({},g,{cached,check(){if(++checks>2)throw new DOMException('stop','AbortError');}}),{name:'AbortError'});
});
