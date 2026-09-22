import {positionAt} from './core.js';
import {moveGrade,reviewPlayedMove} from './teacher-analysis.js';

export function reviewTargets(game,{before=game.moves.length,plies=8}={}){
  const end=Math.max(0,Math.min(before,game.moves.length)),start=Math.max(0,end-plies),p=positionAt(game.initial,game.moves.slice(0,start)),targets=[];
  for(let i=start;i<end;i++){if(p.color===game.human)targets.push({root:{initial:game.initial,moves:game.moves.slice(0,i)},played:game.moves[i],ply:i+1});p.doMove(p.createMoveByUSI(game.moves[i]));}
  return {start,end,targets};
}
export async function reviewPast(engine,game,{before,plies=8,time=1000,check=()=>{},onProgress=()=>{},cached=()=>null}={}){
  const window=reviewTargets(game,{before,plies}),items=[];
  for(const t of window.targets){check();onProgress(t.ply+'手目を確認しています…');const old=cached(t);
    const report=old?.time>=time?old:await reviewPlayedMove(engine,t.root,t.played,{time,check,onProgress});check();items.push({...t,report,grade:moveGrade(report)});}
  // An early proven loss of opportunity matters even when the most recent move
  // was best in an already bad position. Do not blame the final move by default.
  const suspect=items.find(i=>i.grade==='concern'&&i.report.checkedAgain&&!i.report.reconsidered)||items.find(i=>i.grade==='review');
  return {...window,items,suspect};
}
