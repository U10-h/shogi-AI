import {positionAt,legalMoves,moveLabel,checkedPV,material,other,sideName,Square,scoreLabel,statusOf} from './core.js';
import {conceptEvidence} from './shogi-language.js';
import {candidateFrontier,focusPool} from './search-policy.js';

export const pieceNames={pawn:'歩',lance:'香',knight:'桂',silver:'銀',gold:'金',bishop:'角',rook:'飛',king:'玉',promPawn:'と',promLance:'成香',promKnight:'成桂',promSilver:'成銀',horse:'馬',dragon:'竜'};
export const positionKey=(root)=>root.initial+'|'+root.moves.join(' ');
export function normalizeNotation(s){return String(s).normalize('NFKC').replace(/[一二三四五六七八九]/g,c=>String('一二三四五六七八九'.indexOf(c)+1)).replace(/[☗☖▲△\s]/g,'').replace(/龍/g,'竜').replace(/王/g,'玉');}
const jpMove=/[1-9][1-9](?:成香|成桂|成銀|[歩香桂銀金角飛玉と馬竜])(?:不成|[右左直上引寄成打])*(?:\([1-9][1-9]\))?/g;
export function moveTokens(text){const s=normalizeNotation(text);const usi=s.match(/(?:[1-9][a-i]|[PLNSGBR]\*)[1-9][a-i]\+?/g);return usi?.length?usi:(s.match(jpMove)||[]);}
export function resolveMove(p,text){
  const tokens=moveTokens(text);if(!tokens.length)return {kind:'none'};
  const token=tokens[0],legal=legalMoves(p);let matches=[];
  if(/^(?:[1-9][a-i]|[PLNSGBR]\*)[1-9][a-i]\+?$/.test(token))matches=legal.filter(m=>m.usi===token);
  else {
    const origin=token.match(/\(([1-9])([1-9])\)$/);const clean=token.replace(/\([1-9][1-9]\)$/,'');
    matches=legal.filter(m=>{
      if(origin&&(!(m.from instanceof Square)||m.from.file!==+origin[1]||m.from.rank!==+origin[2]))return false;
      const full=normalizeNotation(moveLabel(p,m.usi));const drop=!(m.from instanceof Square);
      const simple=String(m.to.file)+m.to.rank+pieceNames[m.pieceType]+(m.promote?'成':'');
      if(clean.endsWith('打'))return drop&&(full===clean||simple+'打'===clean);
      if(/[右左直上引寄]/.test(clean))return full===clean;
      return clean===simple||clean===full||(!m.promote&&clean===simple+'不成');
    });
  }
  if(!matches.length)return {kind:'illegal',token};
  if(matches.length>1)return {kind:'ambiguous',token,choices:matches.map(m=>({usi:m.usi,label:moveLabel(p,m.usi)+' ['+m.usi+']'}))};
  return {kind:'move',usi:matches[0].usi,label:moveLabel(p,matches[0].usi)};
}
export function questionIntent(text){
  if(/[7７七]手|いくつか|複数.*展開|展開.*比較/.test(text))return 'verify';
  if(/[2２二]手(?:進|先)|もう[2２二]手/.test(text))return 'future';
  if(/精読|成立条件|条件を|応手を比較/.test(text))return 'verify';
  if(/もっと|深く|長く|再解析|再検討/.test(text))return 'deeper';
  if(/相手.{0,12}(?:なら|場合|指|受|応)|応手.{0,10}(?:なら|場合)|(?:なら|場合).{0,8}相手/.test(text)&&moveTokens(text).length)return 'reply';
  if(/嬉し|うれし|困る|困り|目指|避けたい|方針|理想|何を狙|どうな/.test(text))return 'plan';
  if(/最善|一番|おすすめ/.test(text))return 'best';
  if(/成功|通る|うまく|上手く|罠|無視/.test(text))return 'opportunity';
  if(/咎|とが|反論|反撃|受け|防|失敗|ダメ|だめ/.test(text))return 'defense';
  if(/ヒント/.test(text))return 'hint';
  if(/比較|差|違/.test(text))return 'compare';
  return 'explain';
}
// Engine scores always belong to the search root's side to move.
export function fromChild(info){return {...info,score:info.type==='mate'?(info.score>0?-1:1)*(Math.abs(info.score)+1):-info.score};}
export function scoreGap(best,chosen){if(!best||!chosen||best.bound||chosen.bound||best.type!=='cp'||chosen.type!=='cp')return null;return best.score-chosen.score;}
export function assessment(best,chosen,same){
  if(same)return '選んだ手は、今回の探索で最善候補になった手です。';
  const gap=scoreGap(best,chosen);
  if(gap===null)return '詰みの評価や探索の境界値を含むため、点差だけでは比較しません。手順を確認しましょう。';
  if(gap< -80)return '追加解析ではあなたの候補が上回りました。探索結果が揺れているため、優劣は未確定です。';
  if(gap<100)return '今回の解析では最善候補との差は小さめです。候補として残し、応手への対応を比べましょう。';
  if(gap<300)return '最善候補より評価が下がっています。相手の応手を確認すると、この手の課題を探れます。';
  return '今回の解析では評価が大きく下がっています。指す前に、相手の厳しい応手を確認したい手です。';
}
function squareName(sq){return sq.file+'一二三四五六七八九'[sq.rank-1];}
function rayCount(p,color,type){
  let n=0;const bishop=type==='bishop';const dirs=bishop?[[1,1],[1,-1],[-1,1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
  for(const sq of p.board.listSquaresByColor(color)){const pc=p.board.at(sq);if(!(bishop?['bishop','horse']:['rook','dragon']).includes(pc.type))continue;
    for(const [dx,dy] of dirs)for(let t=1;t<9;t++){const next=new Square(sq.file+dx*t,sq.rank+dy*t);if(!next.valid)break;const on=p.board.at(next);if(on?.color===color)break;n++;if(on)break;}}
  return n;
}
export function moveFacts(p,usi){
  const m=p.createMoveByUSI(usi);if(!m||!p.isValidMove(m))throw Error('候補手が合法ではありません。');
  const after=positionAt(p.sfen,[usi]),facts=[];
  if(p.checked)facts.push('王手を解消する手です。');
  if(m.capturedPieceType)facts.push(pieceNames[m.capturedPieceType]+'を取り、持ち駒を増やします。');
  if(m.promote)facts.push(pieceNames[m.pieceType]+'を成り、動ける方向を変えます。');
  if(after.checked)facts.push('王手なので、相手は玉への利きを解消する必要があります。');
  for(const [type,name]of[['bishop','角'],['rook','飛車']]){const before=rayCount(p,p.color,type),next=rayCount(after,p.color,type);if(next>before)facts.push(name+'の筋に沿って届く升が'+before+'から'+next+'に増えます（取れることを保証する数ではありません）。');}
  const targets=after.board.listSquaresByColor(other(p.color)).filter(sq=>after.board.at(sq).type!=='king'&&p.board.at(sq)?.color===other(p.color)&&!p.board.hasPower(sq,p.color)&&after.board.hasPower(sq,p.color));
  if(targets.length)facts.push(targets.slice(0,3).map(sq=>squareName(sq)+'の'+pieceNames[after.board.at(sq).type]).join('、')+'へ新たに味方の利きが届きます。相手の受けも確認しましょう。');
  const king=after.board.findKing(p.color);if(king&&['gold','silver','king'].includes(m.pieceType)){const count=(pos)=>pos.board.listSquaresByColor(p.color).filter(sq=>pos.board.at(sq).type!=='king'&&Math.max(Math.abs(sq.file-pos.board.findKing(p.color).file),Math.abs(sq.rank-pos.board.findKing(p.color).rank))===1).length;const a=count(p),b=count(after);if(a!==b)facts.push('玉に隣接する味方の駒が'+a+'枚から'+b+'枚になります。安全性は相手の攻め方と合わせて判断します。');}
  if(!facts.length)facts.push('この一手だけで分かる直接の王手・駒取り・大駒の筋の拡張はありません。続く応手と、その後に選べる手を比較しましょう。');
  return facts;
}
export function lineEvidence(root,pv,limit=10){
  const p=positionAt(root.initial,root.moves),side=p.color,valid=checkedPV(p,pv).slice(0,limit),events=[];const before=material(p,side);
  for(let i=0;i<valid.length;i++){const m=p.createMoveByUSI(valid[i].usi),label=valid[i].label;if(m.capturedPieceType)events.push((i+1)+'手目の'+label+'で'+sideName(p.color)+'が'+pieceNames[m.capturedPieceType]+'を取ります。');p.doMove(m);if(p.checked)events.push((i+1)+'手目の'+label+'は王手です。');}
  const delta=material(p,side)-before;
  return {moves:valid,events:events.slice(0,5),materialDelta:delta,summary:valid.length+'手先までの単純な駒の収支は'+(delta>0?'+':'')+delta+'点（歩100点）。これはエンジンの形勢評価とは別の集計です。'};
}
// A consultation keeps the complete game history, including repetition rights.
export function branchRoot(root,branch,plies=2){
  if(!Number.isInteger(plies)||plies<1||branch.pv.length<plies)throw Error('この読み筋には指定した手数の続きがありません。');
  const prefix=branch.pv.slice(0,plies),p=positionAt(root.initial,root.moves);
  if(checkedPV(p,prefix).length!==plies)throw Error('読み筋の合法性を確認できませんでした。');
  return {initial:root.initial,moves:[...root.moves,...prefix]};
}
export function reportBranches(r){return r.teaching?.lines||[r.best,r.defense,r.opportunity,r.assumption,r.caution].filter(b=>b&&(b.id!=='best'||r.chosen!==r.bestMove));}

// Observable events are ingredients for a plan, not a proof that a move is good.
export function lineOutlook(root,branch,side=positionAt(root.initial,root.moves).color){
  const p=positionAt(root.initial,root.moves),valid=checkedPV(p,branch.pv).slice(0,10);
  const initial=material(p,side),rays={bishop:rayCount(p,side,'bishop'),rook:rayCount(p,side,'rook')};
  const hope=[],worry=[];
  for(let i=0;i<valid.length;i++){
    const m=p.createMoveByUSI(valid[i].usi),mine=p.color===side,where=(i+1)+'手目の'+valid[i].label;
    if(m.capturedPieceType)(mine?hope:worry).push({ply:i+1,text:where+'で'+(mine?'相手の':'自分の')+pieceNames[m.capturedPieceType]+(mine?'を取る。':'を取られる。')});
    if(m.promote)(mine?hope:worry).push({ply:i+1,text:where+'で'+(mine?'自分':'相手')+'の'+pieceNames[m.pieceType]+'が成る。'});
    p.doMove(m);
    if(p.checked)(mine?hope:worry).push({ply:i+1,text:where+'で'+(mine?'相手玉':'自玉')+'に王手がかかる。次の受けまで確認したい。'});
  }
  const delta=material(p,side)-initial;
  if(delta)(delta>0?hope:worry).unshift({ply:valid.length,text:'表示した'+valid.length+'手先では、'+sideName(side)+'の単純な駒の収支が'+(delta>0?'+':'')+delta+'点（歩100点）。途中の取り返しも含む。'});
  for(const [type,name]of[['bishop','角'],['rook','飛車']]){
    const after=rayCount(p,side,type),before=rays[type];
    if(after>before)hope.push({ply:valid.length,text:valid.length+'手先では、自分の'+name+'の筋に沿って届く升が'+before+'から'+after+'に増える。駒取りの成立は別途確認が必要。'});
    if(after<before)worry.push({ply:valid.length,text:valid.length+'手先では、自分の'+name+'の筋に沿って届く升が'+before+'から'+after+'に減る。活動を制限されたのか、目的を果たしたのかを確認したい。'});
  }
  return {side,plies:valid.length,hope:hope.slice(0,3),worry:worry.slice(0,3),materialDelta:delta};
}
export function explainPlan(r,side=r.side){
  const lines=[sideName(side)+'の立場で「実現したいこと」と「避けたいこと」を考えます。以下は、その読み筋どおりに進んだ場合に盤面から確認できる材料です。'];
  for(const b of reportBranches(r)){
    const outlook=lineOutlook(r.root,b,side);
    lines.push(b.title+'：'+b.evidence.moves.slice(0,2).map(m=>m.label).join(' → '));
    lines.push('嬉しい展開の材料：'+(outlook.hope[0]?.text||'この短い手順には、駒得・成り・王手・大駒の筋の拡張の例は見つかりませんでした。何を整えたいか、次の候補を挙げてみましょう。'));
    lines.push('困る展開の注意点：'+(outlook.worry[0]?.text||'この短い手順には、駒損・相手の成り・自玉への王手・大駒の筋の縮小の例は見つかりませんでした。危険がないとは限りません。気になる応手を指定して確かめましょう。'));
  }
  lines.push('駒を取ることや王手をかけること自体が目的ではありません。取り返し、玉の安全、攻めの継続をセットで比べます。', '「この2手の先を相談」で進めたら、①何が実現すれば嬉しいか ②相手に何をされると困るか ③その両方を考えた次の一手、の順に自分の予想を置いてみましょう。');
  return lines.join('\n\n');
}
function terminalInfo(root){const status=statusOf(root.initial,root.moves);if(!status)return null;
  const p=positionAt(root.initial,root.moves);
  if(!legalMoves(p).length)return {rank:1,type:'mate',score:-0,depth:0,bound:false,pv:[],terminal:status};
  return {rank:1,type:'cp',score:0,depth:0,bound:true,pv:[],terminal:status};
}
function safeInfos(root,result){const p=positionAt(root.initial,root.moves);return result.infos.filter(i=>i.pv.length&&checkedPV(p,i.pv).length===i.pv.length).sort((a,b)=>a.rank-b.rank);}
export async function investigate(engine,root,chosen,{time=3000,reply=null,rigor='standard',onProgress=()=>{},check=()=>{}}={}){
  const p=positionAt(root.initial,root.moves);if(statusOf(root.initial,root.moves))throw Error('終局した局面です。一手前に戻って相談してください。');
  const query=async(r,n,label,budget=time)=>{check();onProgress(label);const terminal=terminalInfo(r);if(terminal)return [terminal];const result=await engine.search(r.initial,r.moves,{time:budget,multipv:n});check();const infos=safeInfos(r,result);if(!infos.length)throw Error('十分な読み筋を取得できませんでした。解析時間を増やしてください。');return infos;};
  const warm=rigor==='deep'&&engine.policy?.reuseWarm?engine.peek?.(root.initial,root.moves,{time,multipv:3}):null;
  const warmGap=warm?scoreGap(warm.infos[0],warm.infos[1]):null;
  const reuse=warm&&warmGap!==null&&warmGap>=engine.policy.widenGap;
  const ranking=reuse?safeInfos(root,warm):await query(root,rigor==='deep'?5:3,'最善候補を調べています…',rigor==='deep'&&engine.policy?Math.max(80,Math.round(time*(engine.policy.probeRatio||1))):time);const bestMove=ranking[0].pv[0];chosen=chosen||bestMove;
  const m=p.createMoveByUSI(chosen);if(!m||!p.isValidMove(m))throw Error('この局面では指せない手です。');
  const child={initial:root.initial,moves:[...root.moves,chosen]};
  const responses=await query(child,3,'あなたの候補に対する応手を比べています…');
  const bestResponses=chosen===bestMove?responses:rigor==='deep'&&engine.policy?.efficientDeep?null:await query({initial:root.initial,moves:[...root.moves,bestMove]},3,'最善候補の続きも同じ時間で確認しています…');
  const make=(id,title,first,info)=>({id,title,pv:[first,...info.pv],score:fromChild(info),depth:info.depth,evidence:lineEvidence(root,[first,...info.pv])});
  // Deep review will search this candidate with a focused, equal budget below.
  // Keep the root PV as a seed instead of paying for a soon-discarded search.
  const best=bestResponses?make('best','最善候補の続き',bestMove,bestResponses[0]):{id:'best',title:'最善候補の続き',pv:ranking[0].pv,score:ranking[0],depth:ranking[0].depth,evidence:lineEvidence(root,ranking[0].pv)};
  const defense=make('defense','あなたの候補への最善応手',chosen,responses[0]);
  const alternatives=responses.slice(1).filter(i=>i.type==='cp'&&responses[0].type==='cp'&&!i.bound&&!responses[0].bound&&responses[0].score-i.score>=100);
  const opportunity=alternatives.length?make('opportunity','相手が別の応手を選んだ例',chosen,alternatives.at(-1)):null;
  // Use the same root MultiPV search for a grounded weaker-candidate example.
  const weaker=ranking.slice(1).filter(i=>i.pv[0]!==chosen&&scoreGap(ranking[0],i)>=100&&scoreGap(ranking[0],i)!==null).at(-1);
  const caution=weaker?{id:'caution',title:'評価が低かった別候補の例',pv:weaker.pv,score:weaker,depth:weaker.depth,evidence:lineEvidence(root,weaker.pv)}:null;
  let assumption=null;
  if(reply){const q=positionAt(child.initial,child.moves),rm=q.createMoveByUSI(reply);if(!rm||!q.isValidMove(rm))throw Error('想定した相手の応手は、この局面では指せません。');const lineRoot={initial:root.initial,moves:[...child.moves,reply]};const [info]=await query(lineRoot,1,'指定された相手の応手を調べています…');assumption={id:'assumption',title:'あなたが想定した相手の応手',pv:[chosen,reply,...info.pv],score:info,depth:info.depth,evidence:lineEvidence(root,[chosen,reply,...info.pv])};}
  const report={root:structuredClone(root),side:p.color,chosen,bestMove,time,reply,rigor,createdAt:new Date().toISOString(),ranking,best,defense,opportunity,assumption,caution,facts:{best:moveFacts(p,bestMove),chosen:moveFacts(p,chosen)},gap:scoreGap(best.score,defense.score)};
  report.replyExamples=responses.slice(1,3).map((info,i)=>make('response-'+i,'相手の別の応手',chosen,info));
  if(rigor==='deep')await verifyReport(engine,report,responses,{check,onProgress});
  report.createdAt=new Date().toISOString();
  return report;
}

// Compare like scores only. Positive mate is better than cp; a longer forced
// loss is preferable to a shorter one. Bounds and repetition remain unranked.
export function compareScores(a,b){
  if(!a||!b||a.bound||b.bound)return null;
  if(a.type===b.type){if(a.type==='cp')return Math.sign(a.score-b.score);if((a.score>0)===(b.score>0))return a.score>0?Math.sign(b.score-a.score):Math.sign(Math.abs(a.score)-Math.abs(b.score));}
  const category=x=>x.type==='cp'?0:x.score>0?1:-1;
  return Math.sign(category(a)-category(b));
}
async function verifyReport(engine,r,seeds,{check,onProgress}){
  const p=positionAt(r.root.initial,r.root.moves),initialBest=r.bestMove;
  const candidates=candidateFrontier(r,engine.policy);
  const pool=focusPool(r,engine.policy),time=Math.min(30000,Math.round(r.time*(pool?pool/candidates.length:2)));
  const candidateChecks=[],replyChecks=[];let searches=0;
  const query=async(root,label,budget=time)=>{
    check();onProgress(label+'（'+budget/1000+'秒）');const terminal=terminalInfo(root);if(terminal)return terminal;
    const result=await engine.search(root.initial,root.moves,{time:budget,multipv:1});check();searches++;
    const [info]=safeInfos(root,result);if(!info)throw Error('精読の読み筋を取得できませんでした。');return info;
  };
  for(const [i,usi] of candidates.entries()){
    const child={initial:r.root.initial,moves:[...r.root.moves,usi]},info=await query(child,'候補を一手ずつ精読 '+(i+1)+'/'+candidates.length);
    const pv=[usi,...info.pv];candidateChecks.push({id:'candidate-'+i,title:moveLabel(p,usi)+'を指した場合',pv,score:fromChild(info),depth:info.depth,evidence:lineEvidence(r.root,pv)});
  }
  let best=candidateChecks[0];for(const b of candidateChecks.slice(1))if(compareScores(b.score,best.score)===1)best=b;
  const chosen=candidateChecks.find(b=>b.pv[0]===r.chosen);
  r.bestMove=best.pv[0];r.best={...best,id:'best',title:'精読で選んだ最善候補の続き'};r.defense={...chosen,id:'defense',title:'あなたの候補への最善応手（精読）'};
  r.facts.best=moveFacts(p,r.bestMove);r.gap=scoreGap(best.score,chosen.score);
  const replies=[...new Set([chosen.pv[1],...seeds.map(i=>i.pv[0])].filter(Boolean))].slice(0,3);
  if(r.reply&&!replies.includes(r.reply))replies.push(r.reply);
  for(const [i,reply]of replies.entries()){
    const root={initial:r.root.initial,moves:[...r.root.moves,r.chosen,reply]},info=await query(root,'相手の応手を固定して再確認 '+(i+1)+'/'+replies.length,engine.policy?.replyRatio?Math.min(30000,Math.round(r.time*engine.policy.replyRatio)):time);
    const pv=[r.chosen,reply,...info.pv];const b={id:'reply-'+i,title:'相手が'+moveLabel(positionAt(r.root.initial,[...r.root.moves,r.chosen]),reply)+'の場合',pv,score:info,depth:info.depth,evidence:lineEvidence(r.root,pv)};replyChecks.push(b);
    if(reply===r.reply)r.assumption={...b,id:'assumption',title:'あなたが想定した相手の応手（精読）'};
  }
  // Spend the reserve on a concrete disagreement, rather than re-reading every
  // reply. A remaining disagreement is shown as uncertainty, not hidden.
  let rechecks=0;
  if(engine.policy?.recheckContradiction){
    const suspect=replyChecks.find(b=>scoreGap(r.defense.score,b.score)>=100||b.score.type==='mate'&&compareScores(b.score,r.defense.score)===-1);
    if(suspect&&!suspect.score.terminal){
      const root={initial:r.root.initial,moves:[...r.root.moves,...suspect.pv.slice(0,2)]};
      const info=await query(root,'評価が変わった応手を重点的に確認',Math.min(30000,r.time*2));
      suspect.pv=[r.chosen,suspect.pv[1],...info.pv];suspect.score=info;suspect.depth=info.depth;suspect.evidence=lineEvidence(r.root,suspect.pv);rechecks++;
      if(suspect.pv[1]===r.reply)r.assumption={...suspect,id:'assumption',title:'あなたが想定した相手の応手（再確認）'};
    }
  }
  const exact=replyChecks.filter(b=>b.score.type==='cp'&&!b.score.bound&&!b.score.terminal);
  const better=exact.filter(b=>scoreGap(b.score,r.defense.score)>=100).sort((a,b)=>b.score.score-a.score.score);
  r.opportunity=better.length?{...better[0],id:'opportunity',title:'相手の応手で評価が改善する例（再確認）'}:null;
  const lower=replyChecks.filter(b=>scoreGap(r.defense.score,b.score)>=100||b.score.type==='mate'&&compareScores(b.score,r.defense.score)===-1);
  const alternate=candidateChecks.filter(b=>b.pv[0]!==r.chosen&&b.pv[0]!==r.bestMove&&scoreGap(r.best.score,b.score)>=100).sort((a,b)=>a.score.score-b.score.score)[0];
  r.caution=alternate?{...alternate,id:'caution',title:'精読で評価が低かった別候補'}:null;
  r.verification={initialBest,bestChanged:initialBest!==r.bestMove,time,searches,rechecks,candidates:candidateChecks,replies:replyChecks,unstable:lower.length>0,unranked:candidateChecks.some(b=>compareScores(b.score,best.score)===null)};
}
export function verificationSummary(r){
  const v=r.verification;if(!v)return '精読では、複数の候補と相手の応手を追加で読み直します。';
  const p=positionAt(r.root.initial,r.root.moves),lines=[v.candidates.length+'候補を各'+v.time/1000+'秒で読み直しました。'+(v.bestChanged?'最初の候補 '+moveLabel(p,v.initialBest)+' から '+moveLabel(p,r.bestMove)+' に入れ替わりました。':'最善候補は '+moveLabel(p,r.bestMove)+' のままでした。')];
  if(v.replies.length){
    lines.push('相手の'+v.replies.length+'通りの応手も固定して、その先を再確認しました。');
    for(const b of v.replies)lines.push(b.title+'：'+sideName(r.side)+'視点 '+scoreLabel(b.score)+'。次は '+(b.evidence.moves[2]?.label||'続く合法手なし')+'。');
  }
  if(v.unstable)lines.push('応手を固定した追加探索では、さらに評価が下がる結果も出ました。結論が揺れているため、その応手から先を確かめましょう。');
  if(v.unstable)lines[0]='追加探索で評価が揺れています。'+lines[0];
  if(v.unranked)lines.push('詰み・終局・境界値を含む候補は、単純な点差で順位を決めていません。');
  lines.push('確認した候補と応手の範囲での比較です。相手が狙いを許す応手を選ぶとは限りません。');
  return lines.join('\n\n');
}
export function explainReport(report,intent='explain'){
  if(intent==='verify')return verificationSummary(report);
  const r=report,p=positionAt(r.root.initial,r.root.moves),label=moveLabel(p,r.chosen),bestLabel=moveLabel(p,r.bestMove);
  const lead=assessment(r.best.score,r.defense.score,r.chosen===r.bestMove);
  const scoreText=sideName(r.side)+'から見た評価：最善候補 '+scoreLabel(r.best.score)+'／あなたの候補 '+scoreLabel(r.defense.score)+(r.gap!==null?'。差は約'+Math.round(r.gap)+'点。':'。')+' 異なる探索の比較なので目安です。';
  const continuation=b=>b.evidence.moves.slice(0,6).map(x=>x.label).join(' → ');
  let answer;
  if(intent==='best')answer=['今回の最善候補は'+bestLabel+'です。',scoreText,...r.facts.best,'相手が最も厳しく応じるとみた手順は、'+continuation(r.best)+'。',...r.best.evidence.events,r.best.evidence.summary,'これらは手の働きと具体的な続きです。評価関数の内部の理由を完全に説明するものではありません。'];
  else if(intent==='defense')answer=[label+'への最善応手として、'+(r.defense.evidence.moves[1]?.label||'続く合法手なし')+'を読んでいます。',lead,continuation(r.defense),...r.defense.evidence.events,r.defense.evidence.summary,'まず相手の応手まで進め、その局面で自分の次の候補を選ぶと読みを掘り下げられます。'];
  else if(intent==='opportunity')answer=r.opportunity?['比較した応手の中では、相手が'+r.opportunity.evidence.moves[1]?.label+'と応じると、あなたから見た評価は'+scoreLabel(r.opportunity.score)+'です。最善応手の場合は'+scoreLabel(r.defense.score)+'です。',continuation(r.opportunity),...r.opportunity.evidence.events,'相手がこの応手を選んだ場合の例であり、勝ちや成功を保証する手順ではありません。']:['今回比較した応手の中には、評価が明確に改善する例を見つけられませんでした。','想定する相手の応手を入力すると、その手を固定して確認できます。例：「相手が3四歩なら？」。局面に合う手を指定してください。'];
  else if(intent==='reply'&&r.assumption)answer=['想定した応手を固定すると、あなたから見た評価は'+scoreLabel(r.assumption.score)+'です。相手の最善応手の場合は'+scoreLabel(r.defense.score)+'です。',continuation(r.assumption),...r.assumption.evidence.events,r.assumption.evidence.summary];
  else if(intent==='hint')answer=['まず'+(p.checked?'王手をどう解消するか':'相手が'+(r.defense.evidence.moves[1]?.label||'最善の応手')+'と応じた後の、自分の次の一手')+'を考えてみましょう。','駒の得だけでなく、次に王手や駒取りが続くかを確認します。読み筋ボタンを開くと具体的な続きが見られます。'];
  else answer=[label+'について：'+lead,scoreText,...r.facts.chosen,'相手の厳しい応手を含む続きは、'+continuation(r.defense)+'。',...r.defense.evidence.events,r.defense.evidence.summary,'比較する最善候補は'+bestLabel+'。'+r.facts.best.join(' '),'気になる相手の応手や「なぜ？」「もっと深く」を続けて質問できます。'];
  if(r.verification?.unstable)answer.unshift('応手を固定した追加探索で評価が揺れています。以下の候補比較は暫定です。「読み筋」で再確認した応手を比べましょう。');
  return answer.filter(Boolean).join('\n\n');
}
export function reportEvidence(r,side=r.side){
  const p=positionAt(r.root.initial,r.root.moves),items=[{id:'position',text:'現在の相談は'+r.root.moves.length+'手目。手番と評価値の視点は'+sideName(r.side)+'。嬉しい・困る展開を考える側は'+sideName(side)+'。手番と考える側が異なる場合は混同しない。'},{id:'comparison',text:explainReport(r,'compare').slice(0,500)}];
  const branches=[...reportBranches(r)];if(!branches.some(b=>b.id==='best'))branches.push(r.best);
  for(const branch of branches){const resultText=sideName(r.side)+'視点の評価 '+scoreLabel(branch.score)+'。この順を選んだ場合の読み。'+branch.evidence.events.slice(0,2).join(' ');items.push({id:branch.id,kind:'line',title:branch.title,moves:branch.evidence.moves.map(x=>x.label),resultText,text:branch.title+'：'+branch.evidence.moves.map(x=>x.label).join(' → ')+'。'+resultText+branch.evidence.summary});
    const outlook=lineOutlook(r.root,branch,side);items.push({id:branch.id+'_outlook',text:branch.title+'。'+sideName(side)+'から見た条件付きの材料。嬉しい：'+(outlook.hope[0]?.text||'今回の短い読みでは未確認')+' 困る：'+(outlook.worry[0]?.text||'今回の短い読みでは未確認')+'。単独で手の良さ・勝敗を断定できない。'});
  }
  items.push({id:'working',text:moveLabel(p,r.chosen)+'の働き：'+r.facts.chosen.join(' ')});
  items.push(...conceptEvidence(r.root,r.defense,side));
  if(r.verification)items.push({id:'verification',text:verificationSummary(r)});
  return items;
}
