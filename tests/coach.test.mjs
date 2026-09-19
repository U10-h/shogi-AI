import test from 'node:test';
import assert from 'node:assert/strict';
import {START,positionAt,checkedPV} from '../dist/core.js';
import {resolveMove,fromChild,scoreGap,investigate,explainReport,questionIntent} from '../dist/coach-analysis.js';
import {validateTutorReply} from '../dist/tutor.js';

test('candidate notation handles Japanese, USI, ambiguity and illegal moves',()=>{
 const p=positionAt(START,[]);
 assert.equal(resolveMove(p,'７六歩で角道を開けたい').usi,'7g7f');
 assert.equal(resolveMove(p,'7g7fはどう？').usi,'7g7f');
 assert.equal(resolveMove(p,'５八金').kind,'ambiguous');
 assert.equal(resolveMove(p,'５八金右').usi,'4i5h');
 assert.equal(resolveMove(p,'５八金(69)').usi,'6i5h');
 assert.equal(resolveMove(p,'7五歩はどう？').kind,'illegal');
 assert.equal(questionIntent('相手が３四歩なら？'),'reply');
 assert.equal(questionIntent('最善手をもっと深く'),'deeper');
});
test('score conversion includes mate distance and never mixes mate with centipawns',()=>{
 assert.equal(fromChild({type:'cp',score:250}).score,-250);
 assert.equal(fromChild({type:'mate',score:-3}).score,4);
 assert.equal(fromChild({type:'mate',score:5}).score,-6);
 assert.equal(fromChild({type:'mate',score:-0}).score,1);
 assert.equal(scoreGap({type:'cp',score:100},{type:'cp',score:-80}),180);
 assert.equal(scoreGap({type:'mate',score:5},{type:'cp',score:100}),null);
 assert.equal(scoreGap({type:'cp',score:100,bound:true},{type:'cp',score:-80}),null);
});
const info=(pv,score,rank=1)=>({pv,score,rank,type:'cp',bound:false,depth:8});
test('comparison preserves the root, scores both sides correctly and grounds alternate responses',async()=>{
 const root={initial:START,moves:[]},calls=[];
 const engine={async search(initial,moves,options){calls.push({moves:[...moves],options});let infos;
  if(!moves.length)infos=[info(['2g2f','3c3d'],120),info(['7g7f','3c3d'],100,2)];
  else if(moves.length===2)infos=[info(['2g2f','3c3d'],200)];
  else if(moves[0]==='7g7f')infos=[info(['3c3d','2g2f'],-30),info(['8c8d','2g2f'],-300,2)];
  else infos=[info(['3c3d','7g7f'],-120)];
  return {bestmove:infos[0].pv[0],infos};}};
 const report=await investigate(engine,root,'7g7f',{time:1000,reply:'8c8d'});
 assert.deepEqual(root.moves,[]);assert.equal(report.best.score.score,120);assert.equal(report.defense.score.score,30);assert.equal(report.gap,90);
 assert.equal(report.opportunity.pv[1],'8c8d');assert.equal(report.opportunity.score.score,300);assert.equal(report.assumption.score.score,200);
 for(const branch of [report.best,report.defense,report.opportunity,report.assumption])assert.equal(checkedPV(positionAt(START,[]),branch.pv).length,branch.pv.length);
 assert.match(explainReport(report,'best'),/２六歩/);assert.match(explainReport(report,'reply'),/200/);assert.equal(calls.length,4);
});
test('cancelling a comparison prevents subsequent searches',async()=>{
 let count=0,cancelled=false;
 const engine={async search(){count++;cancelled=true;return {infos:[info(['7g7f'],1)]};}};
 await assert.rejects(investigate(engine,{initial:START,moves:[]},null,{check:()=>{if(cancelled)throw Error('cancelled');}}),/cancelled/);assert.equal(count,1);
});
test('language supplement must cite evidence and may not invent moves or scores',()=>{
 const evidence=[{id:'best',text:'☗７六歩 → ☖３四歩。評価は120点です。'}];
 assert.equal(validateTutorReply('{"answer":"７六歩の後の応手を確認しましょう。","evidence_ids":["best"]}',evidence).evidence_ids[0],'best');
 assert.throws(()=>validateTutorReply('{"answer":"２六歩が有効です。","evidence_ids":["best"]}',evidence));
 assert.throws(()=>validateTutorReply('{"answer":"評価は500点です。","evidence_ids":["best"]}',evidence));
 assert.throws(()=>validateTutorReply('{"answer":"必勝です。","evidence_ids":["best"]}',evidence));
 assert.throws(()=>validateTutorReply('{"answer":"読むべきです。","evidence_ids":["invented"]}',evidence));
});
