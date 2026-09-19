import test from 'node:test';
import assert from 'node:assert/strict';
import {START,positionAt,legalMoves,newGame,validateGame} from '../dist/core.js';
import {lineEvidence,moveFacts} from '../dist/coach-analysis.js';
import {moveGrade,teacherComment,teacherAnswer,reviewPlayedMove,sameLesson,teachingEnabled} from '../dist/teacher-analysis.js';

function report(gap=0){
  const root={initial:START,moves:[]},pv=['7g7f','3c3d','2g2f'];
  const defense={pv,score:{type:'cp',score:20,bound:false},evidence:lineEvidence(root,pv)};
  return {root,side:'black',chosen:'7g7f',bestMove:'2g2f',best:{...defense,pv:['2g2f'],score:{type:'cp',score:20+gap,bound:false},evidence:lineEvidence(root,['2g2f'])},defense,facts:{chosen:moveFacts(positionAt(START,[]),'7g7f'),best:moveFacts(positionAt(START,[]),'2g2f')}};
}
test('teacher praises sound candidates and describes a reply, without equating a capture with a good move',()=>{
  const r=report(),c=teacherComment(r,{first:true});assert.equal(c.grade,'good');assert.match(c.text,/いいですね/);assert.match(c.text,/３四歩/);assert.match(c.question,/狙い/);
  r.best.score.score=350;assert.equal(moveGrade(r),'concern');assert.doesNotMatch(teacherComment(r).text,/いいですね/);
  assert.match(teacherAnswer(r,{goal:'attack'}),/攻めを続けたい/);
  assert.match(teacherAnswer(r,{text:'銀を使いたい'}),/狙いと、相手の応手/);
});
test('unstable, bounded and forced losing positions are not marked as careless mistakes',()=>{
  const r=report(400);r.best.score.bound=true;assert.equal(moveGrade(r),'uncertain');r.best.score.bound=false;
  r.reconsidered=true;assert.equal(moveGrade(r),'uncertain');r.reconsidered=false;
  r.best.score={type:'mate',score:-10};r.defense.score={type:'mate',score:-8};assert.equal(moveGrade(r),'resilient');
  r.defense.score={type:'mate',score:5};assert.equal(moveGrade(r),'good');
});
test('a suspected error is checked again equally; a changed verdict stays uncertain',async()=>{
  const calls=[];
  const engine={async search(initial,moves,{time,multipv}){
    calls.push({moves:[...moves],time,multipv});const p=positionAt(initial,moves),pv=[];
    for(let i=0;i<4;i++){const m=i===0&&!moves.length?p.createMoveByUSI('2g2f'):legalMoves(p)[0];if(!m)break;pv.push(m.usi);p.doMove(m);}
    const score=multipv===1?0:moves[0]==='7g7f'?300:0;
    return {infos:[{rank:1,type:'cp',score,bound:false,pv,depth:8}]};
  }};
  const r=await reviewPlayedMove(engine,{initial:START,moves:[]},'7g7f',{time:500});
  assert.equal(calls.length,5);assert.deepEqual(calls.slice(-2).map(c=>[c.time,c.multipv]),[[1000,1],[1000,1]]);
  assert(r.checkedAgain);assert(r.reconsidered);assert.equal(moveGrade(r),'uncertain');
});
test('lesson checkpoints survive board exploration, but reject changed games, results and moves',()=>{
  const g=newGame();g.moves=['7g7f'];const l={gameId:g.id,checkpoint:{initial:g.initial,moves:[...g.moves]},result:null};
  assert(sameLesson(l,g));assert(!sameLesson(l,{...g,moves:[]}));assert(!sameLesson(l,{...g,result:'投了'}));assert(!sameLesson(l,{...g,id:'other'}));
  assert(teachingEnabled(g));assert(!teachingEnabled({...g,clockMode:'match'}));
  g.teachingNotes=[{ply:1,move:'7g7f',grade:'good',goal:'角道を開けたい',note:'角の筋を確認',action:'continue'}];g.teacherPending={ply:1,move:'7g7f'};
  const restored=validateGame(JSON.parse(JSON.stringify(g)));assert.equal(restored.teachingNotes[0].goal,'角道を開けたい');assert.equal(restored.teacherPending.move,'7g7f');
  restored.moves=[];assert.equal(validateGame(restored).teacherPending,null);
});
