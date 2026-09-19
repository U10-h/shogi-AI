import {positionAt,moveLabel,checkedPV,scoreLabel} from './core.js';
import {investigate,scoreGap,fromChild,lineEvidence,positionKey,pieceNames} from './coach-analysis.js';
import {readingReason,readingComparison} from './reading.js';
import {teachingComparison} from './teaching-lines.js';

export const teachingEnabled=game=>game.clockMode==='learning'||game.clockMode==='unlimited';
export function sameLesson(lesson,game){return !!lesson&&lesson.gameId===game.id&&positionKey(lesson.checkpoint)===positionKey({initial:game.initial,moves:game.moves})&&lesson.result===game.result;}
export function moveGrade(r){
  const a=r.best.score,b=r.defense.score,gap=scoreGap(a,b);
  if(a.bound||b.bound||r.verification?.unstable||r.reconsidered||gap!==null&&gap< -80)return 'uncertain';
  if(b.type==='mate')return b.score>0?'good':a.type==='mate'&&a.score<=0?'resilient':'concern';
  if(a.type==='mate'&&a.score>0)return 'concern';
  if(gap===null)return 'uncertain';
  if(gap>=200)return 'concern';if(gap>=100)return 'review';
  return b.score< -600?'resilient':'good';
}
export async function reviewPlayedMove(engine,root,played,{time=2000,rigor='standard',check=()=>{},onProgress=()=>{}}={}){
  const report=await investigate(engine,root,played,{time,rigor,check,onProgress});
  if(moveGrade(report)==='concern'&&report.bestMove!==played){
    const previous=moveGrade(report),focusedTime=Math.min(30000,time*2),results=[];
    for(const usi of [report.bestMove,played]){
      check();onProgress('この手の評価を、もう一度確かめています…');
      const child={initial:root.initial,moves:[...root.moves,usi]};
      // Terminal branches were already resolved without querying the engine.
      const old=usi===played?report.defense:report.best;
      if(old.score.terminal){results.push(old);continue;}
      const result=await engine.search(child.initial,child.moves,{time:focusedTime,multipv:1});check();
      const p=positionAt(child.initial,child.moves),info=result.infos.find(x=>x.rank===1&&x.pv.length&&checkedPV(p,x.pv).length===x.pv.length);
      if(!info)throw Error('手の評価を十分に確認できませんでした。');
      const pv=[usi,...info.pv];results.push({...old,pv,score:fromChild(info),depth:info.depth,evidence:lineEvidence(root,pv)});
    }
    [report.best,report.defense]=results;report.gap=scoreGap(report.best.score,report.defense.score);report.checkedAgain=true;
    if(moveGrade(report)!==previous)report.reconsidered=true;
  }
  return report;
}
const spoken=label=>label.replace(/^[☗☖]/,'');
const labelAt=(r,usi)=>spoken(moveLabel(positionAt(r.root.initial,r.root.moves),usi));
function continuation(branch){
  const moves=branch.evidence.moves;
  return moves[1]?'相手が'+spoken(moves[1].label)+'なら、'+(moves[2]?spoken(moves[2].label)+'と続ける手があります。':'その局面で次の手を考えましょう。'):'';
}
export function movePoint(r,which='chosen'){
  return readingReason(r,which==='best'?r.best:r.defense);
}
// Choose one concrete event, favoring a major-piece loss over an ordinary pawn
// exchange. Always describe it as a conditional line, not as a forced outcome.
function moment(r,branch,mine,side=r.side){
  const p=positionAt(r.root.initial,r.root.moves),events=[];
  for(const item of checkedPV(p,branch.pv).slice(0,10)){
    const m=p.createMoveByUSI(item.usi),own=p.color===side,label=spoken(item.label);
    if(own===mine&&m.capturedPieceType){
      const piece=pieceNames[m.capturedPieceType],weight=['rook','bishop','dragon','horse'].includes(m.capturedPieceType)?4:['gold','silver','promPawn'].includes(m.capturedPieceType)?3:1;
      events.push({weight,text:mine?label+'で相手の'+piece+'を取れる筋があります。':label+'でこちらの'+piece+'を取られる筋があります。'});
    }
    p.doMove(m);
    if(own===mine&&p.checked)events.push({weight:2,text:mine?label+'と王手をかける筋があります。':label+'と王手をかけられる筋が気になります。'});
  }
  return events.sort((a,b)=>b.weight-a.weight)[0]?.text||'';
}
export function teacherComment(r,{first=false,passive=false,brief=false}={}){
  const grade=moveGrade(r),label=labelAt(r,r.chosen),point=movePoint(r),risk=moment(r,r.defense,false),reply=r.defense.evidence.moves[1]?.label;
  let text,question='';
  if(passive)text='ここでは'+labelAt(r,r.bestMove)+'を考えてみましょう。'+(movePoint(r,'best')||continuation(r.best));
  else if(grade==='concern'){
    text=label+'は、少し気になります。'+(risk?'もう少し先まで読むと、'+risk:reply?'相手の'+spoken(reply)+'への備えを考えておきたいですね。':'ほかの候補と比べると、形勢を損ねている可能性があります。');
    question='どんな狙いで指しましたか？';
  }else if(grade==='review'){
    text=label+'を指したあと、相手の応手を一つ確認しておきたいです。'+(risk||continuation(r.defense));question='この続きは、どう考えていましたか？';
  }else if(grade==='uncertain')text='この手は、まだ良し悪しを決められません。読みを深めると判断が変わるので、まず相手の応手を一緒に確かめましょう。';
  else if(grade==='resilient')text='厳しい局面ですが、この手で粘る余地はありそうです。'+continuation(r.defense);
  else text='いいですね。相手の応手まで読んでも、今のところ有力な一手です。'+(brief?continuation(r.defense):point+' '+readingComparison(r));
  if(!brief&&!passive&&['concern','review'].includes(grade))text+='\n\n'+readingReason(r)+' '+readingComparison(r);
  if(!brief&&r.teaching)text+='\n\n'+teachingComparison(r);
  if(first&&!question&&grade==='good')question='次は、どんな狙いで進めたいですか？';
  return {grade,text,question,reply,theme:risk?'相手の応手':point?'駒の働き':'次の一手'};
}
export const goalLabels={attack:'攻めを続けたい',defend:'受けを固めたい',develop:'駒を働かせたい',unsure:'まだ狙いが曖昧'};
function composeAnswer(r,{text='',goal=null,intent='explain',side=r.side,round=0}={}){
  const risk=moment(r,r.defense,false,side),hope=moment(r,r.defense,true,side),reply=r.defense.evidence.moves[1]?.label;
  if(intent==='best'||intent==='compare')return '比べるなら、'+labelAt(r,r.bestMove)+'が有力です。'+readingReason(r,r.best,side)+'\n\n'+readingComparison(r)+' 下の盤面で、指した手の続きと切り替えて比べましょう。';
  if(intent==='opportunity')return r.opportunity?'相手が'+spoken(r.opportunity.evidence.moves[1].label)+'と応じてくれれば、こちらにとって改善する余地があります。'+(moment(r,r.opportunity,true,side)||continuation(r.opportunity))+'ただ、相手がこの順を選ぶとは限りません。':'今の読みでは、こちらの狙いがうまく通る例はまだ見つかっていません。相手にどんな手を指してほしいと思っていますか？';
  if(intent==='reply'&&r.assumption)return 'その応手なら、'+(r.assumption.evidence.moves[2]?spoken(r.assumption.evidence.moves[2].label)+'と続ける手があります。':'その先はまだ十分に読めていません。')+(moment(r,r.assumption,false,side)||moment(r,r.assumption,true,side)||'盤面を進めて、次に使いたい駒を考えてみましょう。');
  if(intent==='defense')return (reply?'相手には'+spoken(reply)+'という応手があります。':'この局面からの応手は、まだ十分に読めていません。')+(risk||'その先で、こちらが何を狙えるかを考えておきたいですね。');
  if(intent==='plan')return (hope?'この先には、'+hope:'まずは、次に働かせたい駒を一枚決めてみましょう。')+(risk?'一方で、'+risk:'相手がどう動くかも見ながら考えたいですね。')+'\n\nあなたは、どんな形になれば指しやすいと思いますか？';
  if(intent==='verify'||intent==='deeper')return r.verification?.unstable?'もう少し読んでみましたが、まだ評価が揺れています。相手の応手によって、どこで話が変わるのかを見てみましょう。':(r.verification?.bestChanged?'読み直すと、':'もう少し読んでみても、')+labelAt(r,r.bestMove)+'が有力でした。'+readingReason(r,r.best,side)+'\n\n'+readingComparison(r);
  if(goal==='attack')return '攻めを続けたいのですね。'+(risk?'それなら、'+risk+'ここまで許しても攻めが続くかを考えたいです。':hope||continuation(r.defense))+'\n\n'+(reply?'相手が'+spoken(reply)+'と来たら、次はどう指すつもりでしたか？':'次に狙いたい手を教えてください。');
  if(goal==='defend')return '受けを固めたいのですね。'+(risk?'まず、'+risk:continuation(r.defense))+'\n\nどの駒や場所を守ろうと考えていましたか？';
  if(goal==='develop')return '駒を働かせたいのですね。'+(movePoint(r)||continuation(r.defense))+'\n\n次に使いたい駒は、どれでしょうか？';
  if(goal==='unsure'||intent==='hint')return 'では、相手の手から考えてみましょう。'+(reply?'相手には'+spoken(reply)+'という応手があります。この手で、何を狙われそうですか？':'この局面で、相手に一番指されると困る手は何でしょうか？');
  const lead=text?'その狙いと、相手の応手を合わせて考えてみましょう。':round?'さっきの続きを、もう一つだけ見てみましょう。':'';
  const focus=moveGrade(r)==='concern'||moveGrade(r)==='review'?risk:movePoint(r)||hope;
  return lead+(focus||'この手の意味は、相手の応手まで含めて考えると分かりやすくなります。')+'\n\n'+continuation(r.defense)+(reply&&text?' このあとも、考えていた狙いを続けられそうですか？':'');
}
export function teacherAnswer(r,options={}){let answer=composeAnswer(r,options);if(r.teaching&&['verify','deeper','compare','best','plan'].includes(options.intent)){const comparison=teachingComparison(r);if(comparison)answer+='\n\n'+comparison;}return moveGrade(r)==='uncertain'&&!['verify','deeper'].includes(options.intent)?'まだ評価が揺れているので、ここからは仮の見立てです。'+answer:answer;}
function lineText(branch,n=4){return branch.evidence.moves.slice(0,n).map(m=>m.label).join(' → ');}
export function teacherEvidence(r,comment){return [{id:'teacher',text:'指した手への講評。'+comment.text+' '+comment.question},{id:'played',text:'指した手の続き '+lineText(r.defense,12)+'。'+readingReason(r)},{id:'alternative',text:'比較する候補 '+lineText(r.best,12)+'。'+readingReason(r,r.best)},{id:'evaluation',text:readingComparison(r)+(comment.grade==='uncertain'?'結論は未確定。':'有限時間の探索による暫定評価。')}];}
