import test from 'node:test';
import assert from 'node:assert/strict';
import {START,positionAt,checkedPV} from '../dist/core.js';
import {resolveMove,fromChild,scoreGap,investigate,explainReport,questionIntent,branchRoot,lineOutlook,explainPlan,reportEvidence,compareScores,verificationSummary} from '../dist/coach-analysis.js';
import {validateTutorReply,selectTutorEvidence} from '../dist/tutor.js';

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
 assert.equal(questionIntent('この局面から2手進んだ先では？'),'future');
 assert.equal(questionIntent('ここから何を目指す？'),'plan');
 assert.equal(questionIntent('嬉しい展開と困る展開を知りたい'),'plan');
});
test('two-ply continuation preserves full history, side to move and the source branch',()=>{
 const root={initial:START,moves:['7g7f']},branch={pv:['3c3d','2g2f','8c8d','2f2e']};
 const next=branchRoot(root,branch);
 assert.deepEqual(next,{initial:START,moves:['7g7f','3c3d','2g2f']});
 assert.equal(positionAt(next.initial,next.moves).color,'white');
 next.moves.push('8c8d');assert.deepEqual(root.moves,['7g7f']);assert.equal(branch.pv.length,4);
 assert.throws(()=>branchRoot(root,{pv:['3c3d']}),/続き/);
 assert.throws(()=>branchRoot(root,{pv:['3c3d','7g7f']}),/合法/);
});
test('outlooks distinguish capture from recapture and keep the learner perspective on either turn',()=>{
 const root={initial:START,moves:['7g7f']},branch={pv:['3c3d','8h2b+','3a2b']};
 const black=lineOutlook(root,branch,'black'),white=lineOutlook(root,branch,'white');
 assert.equal(black.materialDelta,0);assert.equal(white.materialDelta,0);
 assert(black.hope.some(x=>x.ply===2&&/相手の角を取る/.test(x.text)));
 assert(black.worry.some(x=>x.ply===3&&/自分の馬を取られる/.test(x.text)));
 assert(white.worry.some(x=>/自分の角を取られる/.test(x.text)));
 assert(white.hope.some(x=>/相手の馬を取る/.test(x.text)));
 const quiet=lineOutlook({initial:START,moves:[]},{pv:['1g1f','1c1d']});
 assert.equal(quiet.hope.length,0);assert.equal(quiet.worry.length,0);
});
test('a weaker candidate example must come from a measured root line, never an invented failure',async()=>{
 const engine={async search(initial,moves){return {infos:!moves.length?[info(['7g7f','3c3d'],150),info(['2g2f','8c8d'],-120,2)]:[info(['3c3d','2g2f'],-150)]};}};
 const report=await investigate(engine,{initial:START,moves:[]},'7g7f');
 assert.deepEqual(report.caution.pv,['2g2f','8c8d']);assert.equal(report.caution.score.score,-120);
 assert.match(explainPlan(report),/危険がないとは限りません|未確認|短い手順/);
 assert.match(reportEvidence(report,'white').find(e=>e.id==='position').text,/考える側は後手/);
 assert(reportEvidence(report).some(e=>e.id==='caution_outlook'));
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
test('bounded dialogue evidence keeps the position and requested future outlooks first',()=>{
 const evidence=['comparison','working','best','best_outlook','defense','defense_outlook','position','opportunity_outlook'].map(id=>({id,text:'根拠'.repeat(200)}));
 const packed=selectTutorEvidence(evidence,'嬉しい展開と困る展開は？');
 assert.equal(packed[0].id,'position');assert.equal(packed[1].id,'defense_outlook');
 assert(packed.reduce((n,e)=>n+e.text.length,0)<=1100);
 assert.equal(selectTutorEvidence(evidence,'最善手の理由は？')[1].id,'best');
});
test('focused deep searches rerank candidates fairly and expose contradictory reply checks',async()=>{
 const root={initial:START,moves:[]},calls=[];
 const engine={async search(initial,moves,options){calls.push({moves:[...moves],options});let infos;
  if(!moves.length)infos=[info(['2g2f','3c3d'],100),info(['7g7f','3c3d'],80,2),info(['5g5f','3c3d'],0,3)];
  else if(moves.length===1){const next=moves[0]==='7g7f'?'2g2f':'7g7f';const score={'2g2f':-40,'7g7f':-160,'5g5f':200}[moves[0]];
   infos=options.multipv===1?[info(['3c3d',next],score)]:[info(['3c3d',next],score),info(['8c8d',next],score-50,2),info(['5c5d',next],score-100,3)];
  }else{const score={'3c3d':120,'8c8d':-80,'5c5d':380}[moves[1]];infos=[info(['2g2f',moves[1]==='3c3d'?'8c8d':'3c3d'],score)];}
  return {infos,bestmove:infos[0].pv[0]};}};
 const r=await investigate(engine,root,'7g7f',{time:200,rigor:'deep'});
 assert.equal(calls[0].options.multipv,5);assert.equal(r.bestMove,'7g7f');assert.equal(r.best.score.score,160);
 assert.equal(r.verification.bestChanged,true);assert.equal(r.verification.unstable,true);assert.equal(r.verification.replies.length,3);
 assert.equal(r.opportunity.pv[1],'5c5d');assert.equal(r.opportunity.score.score,380);
 const candidateCalls=calls.filter(c=>c.moves.length===1&&c.options.multipv===1);assert.equal(candidateCalls.length,3);assert(candidateCalls.every(c=>c.options.time===400));
 assert(calls.filter(c=>c.moves.length===2).every(c=>c.options.time===400&&c.options.multipv===1));
 assert.match(verificationSummary(r),/結論が揺れ/);assert.match(explainReport(r,'verify'),/入れ替わりました/);
 for(const b of [...r.verification.candidates,...r.verification.replies])assert.equal(checkedPV(positionAt(START,[]),b.pv).length,b.pv.length);
 assert.deepEqual(root.moves,[]);
});
test('deep ranking orders mate distances and rejects comparisons with bounds',()=>{
 const cp=n=>({type:'cp',score:n}),mate=n=>({type:'mate',score:n});
 assert.equal(compareScores(mate(3),cp(10000)),1);assert.equal(compareScores(mate(-3),cp(-10000)),-1);
 assert.equal(compareScores(mate(3),mate(7)),1);assert.equal(compareScores(mate(-7),mate(-3)),1);
 assert.equal(compareScores({...mate(1),terminal:'後手の負け'},cp(100)),1);
 assert.equal(compareScores({...cp(5),bound:true},cp(0)),null);
});
