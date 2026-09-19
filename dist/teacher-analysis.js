import {positionAt,moveLabel,checkedPV,legalMoves,scoreLabel} from './core.js';
import {investigate,scoreGap,fromChild,lineEvidence,lineOutlook,positionKey} from './coach-analysis.js';

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
export async function reviewPlayedMove(engine,root,played,{time=2000,check=()=>{},onProgress=()=>{}}={}){
  const report=await investigate(engine,root,played,{time,check,onProgress});
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
function usefulFacts(r){return r.facts.chosen.filter(s=>!s.startsWith('この一手だけで'));}
function lineText(branch,n=4){return branch.evidence.moves.slice(0,n).map(m=>m.label).join(' → ');}
function observation(r,key){
  const out=lineOutlook(r.root,r.defense,r.side);
  return out[key].find(x=>!/単純な駒の収支/.test(x.text))?.text||'';
}
export function teacherComment(r,{first=false,previousGoal='',passive=false}={}){
  const p=positionAt(r.root.initial,r.root.moves),label=moveLabel(p,r.chosen),grade=moveGrade(r),facts=usefulFacts(r),reply=r.defense.evidence.moves[1]?.label,next=r.defense.evidence.moves[2]?.label;
  let text;
  if(passive)text='この局面では、'+moveLabel(p,r.bestMove)+'を候補に考えてみましょう。'+r.facts.best[0];
  else if(grade==='good'){
    text=legalMoves(p).length===1?'王手などの制約がある局面で、指せる手を選べています。':label+'は、今回の読みではよい候補です。';
    text+=facts[0]||'直接駒を取る手ではありませんが、続きまで見てみましょう。';
    if(reply&&next)text+='相手が'+reply+'なら、'+next+'と続ける読みがあります。';
  }else if(grade==='concern'){
    text=label+'は、少し立ち止まって考えたい手です。';
    const risk=observation(r,'worry');
    if(reply)text+='相手には'+reply+'という応手があります。';
    text+=risk?risk+'この展開を許しても、狙いが見合うかを確かめたいです。':'読み直しても他の候補より評価が下がりました。ただ、評価差だけで悪い理由を決めず、狙いと続きの手順を一緒に確かめましょう。';
  }else if(grade==='review')text=label+'にも狙いはありそうです。ただ、'+(reply?'相手の'+reply+'への備え':'相手の応手')+'をもう少し確かめたいです。'+(observation(r,'worry')||facts[0]||'ほかの候補と比べながら考えましょう。');
  else if(grade==='resilient')text='今は厳しい局面ですが、'+label+'は抵抗する候補に残せます。'+(reply?'相手の'+reply+'に対して、どう粘るかを見ましょう。':'最後まで続く手を探しましょう。');
  else text=label+'の良し悪しは、今回の読みではまだ決め切れません。'+(r.reconsidered?'読み直すと最初の判断が変わりました。':'評価が揺れているので、悪い手と決めつけずに確かめたいです。')+(facts[0]||'');
  const needsQuestion=passive||first||grade!=='good'||facts.length===0;
  let question='';
  if(needsQuestion)question=previousGoal?'前には「'+previousGoal.slice(0,50)+'」と話していましたね。この手では、何を実現したかったですか？':'この手では、何を狙っていましたか？';
  return {grade,text,question,reply,next,theme:observation(r,'worry')?'相手の応手':facts.some(s=>/飛車|角/.test(s))?'大駒の働き':'次の一手'};
}
export const goalLabels={attack:'攻めを続けたい',defend:'受けを固めたい',develop:'駒を働かせたい',unsure:'まだ狙いが曖昧'};
export function teacherAnswer(r,{text='',goal=null,more=false}={}){
  const grade=moveGrade(r),risk=observation(r,'worry'),benefit=observation(r,'hope'),facts=usefulFacts(r);
  const p=positionAt(r.root.initial,r.root.moves),reply=r.defense.evidence.moves[1]?.label,next=r.defense.evidence.moves[2]?.label;
  let lead=goal==='unsure'?'では、相手の次の一手から一緒に考えましょう。':goal?'「'+goalLabels[goal]+'」を狙ったのですね。':text?'「'+text.slice(0,100)+'」という考えなのですね。':'理由を、盤面の変化で確認しましょう。';
  let reason;
  if(goal==='defend')reason=risk?'受けを考えるなら、まずこの変化が気になります。'+risk:(facts.find(s=>/王手を解消|玉に隣接/.test(s))||'今回の短い読みだけで玉の安全を保証はできません。相手の応手まで進め、守りたい駒や升を確認しましょう。');
  else if(goal==='attack')reason=(benefit||facts.find(s=>/王手|取り|成り|筋/.test(s))||'攻めが続くかどうかは、相手の応手とセットで見ていきましょう。')+(risk?'一方で、'+risk:'');
  else if(goal==='develop')reason=facts.find(s=>/飛車|角|玉に隣接/.test(s))||'駒の働きは、この一手だけでは判断し切れません。相手の応手の後、次に使いたい駒を決めてみましょう。';
  else reason=(grade==='concern'||grade==='review'?risk:benefit)||facts[0]||'評価値だけでなく、相手が厳しく応じた手順を確かめましょう。';
  const lines=[lead,reason];
  if(reply)lines.push('具体的には '+lineText(r.defense,more?6:3)+' という読みです。'+(next?'相手の'+reply+'のあと、'+next+'まで考えるのが一つの目安です。':''));
  if(r.chosen!==r.bestMove)lines.push('比べたい別の手は '+moveLabel(p,r.bestMove)+' です。'+r.facts.best[0]+'続きは '+lineText(r.best,3)+'。');
  if(grade==='uncertain')lines.push('この比較にはまだ揺れがあります。今の説明だけで正解・不正解を決めないでおきましょう。');
  lines.push(goal==='unsure'&&reply?'相手が'+reply+'と来たら、次に何をしたいですか？ 盤面を進めて考えてみましょう。':'狙いを保つにはどの続きがよいか、盤面で試すか、指し直してみましょう。');
  return lines.filter(Boolean).join('\n\n');
}
export function teacherEvidence(r,comment){return [{id:'teacher',text:'指した手への講評。'+comment.text+' '+comment.question},{id:'played',text:'指した手の続き '+lineText(r.defense,6)+'。'+r.defense.evidence.events.join(' ')},{id:'alternative',text:'比較する候補 '+lineText(r.best,6)+'。'+r.facts.best.join(' ')},{id:'evaluation',text:'今回の評価 '+scoreLabel(r.defense.score)+'／比較候補 '+scoreLabel(r.best.score)+'。'+(comment.grade==='uncertain'?'結論は未確定。':'有限時間の探索による暫定評価。')}];}
