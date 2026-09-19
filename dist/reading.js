import {positionAt,checkedPV,handPieceTypes,Square,other,sideName,scoreLabel} from './core.js';
import {pieceNames} from './coach-analysis.js';

const spoken=s=>s.replace(/^[☗☖]/,'');
function inventory(p,side){
  const counts=Object.fromEntries(handPieceTypes.map(t=>[t,p.hand(side).count(t)]));
  for(const sq of p.board.listSquaresByColor(side)){const pc=p.board.at(sq).unpromoted();if(pc.type!=='king')counts[pc.type]++;}
  return counts;
}
// Counts ownership after the entire displayed sequence, including recaptures.
// Promotion changes strength, but does not falsely count as winning a piece.
export function readingOutcome(root,branch,side=positionAt(root.initial,root.moves).color,plies=12){
  const p=positionAt(root.initial,root.moves),before=inventory(p,side),moves=checkedPV(p,branch.pv).slice(0,plies),events=[];
  for(const [i,item]of moves.entries()){
    const m=p.createMoveByUSI(item.usi),actor=p.color,captured=m.capturedPieceType,promoted=m.promote;
    p.doMove(m);if(captured||promoted||p.checked)events.push({ply:i+1,label:item.label,actor,captured,promoted,check:p.checked});
  }
  const after=inventory(p,side),gains=[],losses=[];
  for(const t of handPieceTypes){const d=after[t]-before[t];if(d)(d>0?gains:losses).push(pieceNames[t]+Math.abs(d)+'枚');}
  const who=sideName(side),balance=gains.length||losses.length?who+'の駒は開始時より'+(gains.length?gains.join('・')+(losses.length?'増え、':'増えています。'):'')+(losses.length?losses.join('・')+'減っています。':''):who+'の駒の枚数は、取り返しまで含めると開始時と同じです。';
  return {position:p,moves,plies:moves.length,events,gains,losses,balance,checked:p.checked,side};
}
export function readingReason(r,branch=r.defense,side=r.side){
  const o=readingOutcome(r.root,branch,side),ms=o.moves;
  if(ms.length<2)return 'この先の読み筋が短く、まだ理由を十分に説明できません。解析時間を延ばして確かめたいです。';
  const line='相手の'+spoken(ms[1].label)+(ms[2]?'に'+spoken(ms[2].label)+'と応じる':'という応手の')+'続きを読んでいます。';
  const late=o.events.find(e=>e.ply>3&&e.actor!==side&&e.captured)||o.events.find(e=>e.ply>3);
  let detail=late?(late.ply+'手先の'+spoken(late.label)+'で'+(late.captured?(late.actor===side?'相手の':'こちらの')+pieceNames[late.captured]+(late.actor===side?'を取る':'を取られる'):late.check?'王手がかかる':'駒が成る')+'順も含め、'):'';
  return line+detail+o.plies+'手先まで進むと、'+o.balance;
}
export function readingComparison(r){
  const who=sideName(r.side),a=scoreLabel(r.defense.score),b=scoreLabel(r.best.score);
  return who+'から見た読みの評価は、この手が'+a+(r.chosen===r.bestMove?'です。今回の最善候補と一致しています。':'、比較候補が'+b+'です。')+' 表示盤面の駒の収支とは別に、その先も探索した評価です。';
}
const el=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text||'';if(cls)e.className=cls;return e;};
export class ReadingBoard {
  constructor(container,onExplore){this.container=container;this.onExplore=onExplore;this.report=null;this.which='defense';this.cursor=6;}
  set(report,side,locked=false){
    if(this.report===report&&this.side===side&&this.locked===locked)return;
    if(this.report!==report){this.report=report;this.which='defense';this.cursor=6;}
    this.side=side;this.locked=locked;this.draw();
  }
  draw(){
    const r=this.report;this.container.hidden=!r;if(!r){this.container.replaceChildren();return;}
    const branches=[['defense','指した手への厳しい応手'],['best','比較する最善候補'],['opportunity','狙いが通る応手の例'],['assumption','自分が想定した応手']].filter(([k])=>r[k]&&(k!=='best'||r.bestMove!==r.chosen));
    if(!branches.some(([k])=>k===this.which))this.which='defense';
    const b=r[this.which],length=checkedPV(positionAt(r.root.initial,r.root.moves),b.pv).length;
    this.cursor=Math.max(0,Math.min(this.cursor,length));const o=readingOutcome(r.root,b,this.side,this.cursor);
    const section=el('div','','reading-card'),heading=el('h3','読みを盤面で確かめる');
    const select=el('select');select.setAttribute('aria-label','盤面で見る読み筋');select.disabled=this.locked;
    for(const [key,title]of branches){const option=el('option',title);option.value=key;select.append(option);}select.value=this.which;select.onchange=()=>{this.which=select.value;this.draw();};
    const count=el('p',(r.root.moves.length+this.cursor)+'手目の局面 · 読みの'+this.cursor+' / '+length+'手先','micro');
    const board=el('div','','reading-board');board.setAttribute('role','img');board.setAttribute('aria-label',this.cursor+'手先の将棋盤。下側は'+sideName(this.side));
    const white=this.side==='white',files=white?[1,2,3,4,5,6,7,8,9]:[9,8,7,6,5,4,3,2,1],ranks=white?[9,8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8,9];
    for(const rank of ranks)for(const file of files){const sq=new Square(file,rank),pc=o.position.board.at(sq),cell=el('span','','reading-cell');cell.setAttribute('aria-label',file+'筋'+rank+'段 '+(pc?sideName(pc.color)+pieceNames[pc.type]:'空き'));
      if(sq.usi===o.moves.at(-1)?.usi.slice(2,4))cell.className+=' last';
      if(pc)cell.append(el('span',pieceNames[pc.type],(pc.color===this.side?'':'opponent')+(pieceNames[pc.type].length>1?' two':'')));board.append(cell);}
    const frame=el('div','','reading-frame'),fileLabels=el('div','','reading-files'),rankLabels=el('div','','reading-ranks');
    for(const n of files)fileLabels.append(el('span',String(n)));for(const n of ranks)rankLabels.append(el('span','一二三四五六七八九'[n-1]));frame.append(fileLabels,board,rankLabels);
    const hand=side=>el('p',sideName(side)+'の持ち駒：'+(handPieceTypes.filter(t=>o.position.hand(side).count(t)).map(t=>pieceNames[t]+o.position.hand(side).count(t)).join(' ')||'なし'),'reading-hand');
    const controls=el('div','','reading-controls');
    for(const [label,next,disabled]of [['一手戻る',this.cursor-1,this.cursor===0],['一手進む',this.cursor+1,this.cursor===length],['読みの最後へ',length,this.cursor===length]]){const btn=el('button',label);btn.disabled=this.locked||disabled;btn.onclick=()=>{this.cursor=next;this.draw();};controls.append(btn);}
    const line=el('p',o.moves.slice(-4).map(m=>m.label).join(' → ')||'候補手を指す前','reading-line');
    const score=el('p','この読みの評価：'+sideName(r.side)+'視点 '+scoreLabel(b.score)+' · 探索深さ '+(b.depth||b.score.depth||0)+'（表示手数とは別）','micro');
    const open=el('button','この盤面から先生に相談');open.disabled=this.locked;open.onclick=()=>this.onExplore(r,b,this.cursor);
    section.append(heading,select,count,hand(other(this.side)),frame,hand(this.side),controls,line,el('p',o.balance,'reading-balance'),score,open,el('p','相手がこの順を選んだ場合の例です。途中で違う手を指すこともできます。','micro'));
    this.container.replaceChildren(section);
  }
}
