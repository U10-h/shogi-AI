import {Position,Square,handPieceTypes,positionAt,moveLabel,checkedPV,exportGame} from './core.js';
const $=id=>document.getElementById(id);
const names={pawn:'歩',lance:'香',knight:'桂',silver:'銀',gold:'金',bishop:'角',rook:'飛',king:'玉',promPawn:'と',promLance:'成香',promKnight:'成桂',promSilver:'成銀',horse:'馬',dragon:'竜'};
const promoted=new Set(['promPawn','promLance','promKnight','promSilver','horse','dragon']);
const ranks=['一','二','三','四','五','六','七','八','九'];
let data,gameIndex=0,index=0,flipped=false,playing=false,timer=null,variation=null;
const game=()=>data?.games[gameIndex];
const engineName=(side,short=false)=>side===game().labSide?(short?'自作AI':'自作AI · Search Lab'):'やねうら王';
function node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
const fmtMs=ms=>(ms/1000).toFixed(2)+'秒';
function scoreText(info,score=info?.score){
 if(!info||score===null||score===undefined)return '—';
 if(info.type==='mate')return score>0?'詰み '+Math.abs(score):'被詰み '+Math.abs(score);
 if(info.type==='lab-mate'||Math.abs(score)>=99000)return score>0?'詰み':'被詰み';
 return (score>0?'+':'')+score+(info.bound?'*':'');
}
function resultText(g){
 if(!g.result)return {title:'対局の記録中',description:'対局データはまだ完了していません。'};
 const reason={'checkmate':'詰み','no-legal-move':'合法手なし',resign:'投了',repetition:'千日手','perpetual-check':'連続王手の千日手','move-limit':'256手で打ち切り'}[g.result.reason]||g.result.reason;
 return {title:g.result.winner?(g.result.winner===g.labSide?'自作AI':'やねうら王')+'の勝ち':g.result.reason==='move-limit'?'打ち切り':'引き分け',description:g.moves.length+'手 · '+reason};
}
function player(container,side,p){
 const el=$(container);el.replaceChildren();const identity=node('div','player-identity');identity.append(node('span','side-symbol',side==='black'?'▲':'△'));
 const name=node('div','player-name',engineName(side));name.append(node('span','player-version',(side==='black'?'先手':'後手')+' · '+(side===game().labSide?'v0.4 / 自作探索':'NNUE KP256 6.03')));identity.append(name);
 const state=node('span','player-state'+(p.color===side?' active':''),p.color===side?(variation?'読みの手番':index===game().moves.length&&game().status==='finished'?'終局':'次の手番'):'');el.append(identity,state);
}
function hand(container,p,side){
 const el=$(container);el.replaceChildren();for(const type of [...handPieceTypes].reverse()){const count=p.hand(side).count(type);if(!count)continue;const n=node('span','hand-piece',names[type]);n.setAttribute('aria-label',names[type]+' '+count+'枚');if(count>1)n.append(node('small','',count));el.append(n);}if(!el.children.length)el.append(node('span','hand-empty','なし'));
}
function renderBoard(){
 const g=game();let sfen=index?g.moves[index-1].afterSfen:g.initial,last=index?g.moves[index-1].usi:null;
 if(variation){sfen=positionAt(variation.row.beforeSfen,variation.pv.slice(0,variation.step)).sfen;last=variation.step?variation.pv[variation.step-1]:null;}
 const p=Position.newBySFEN(sfen),top=flipped?'black':'white',bottom=flipped?'white':'black';
 player('top-player',top,p);player('bottom-player',bottom,p);hand('top-hand',p,top);hand('bottom-hand',p,bottom);
 const files=flipped?[1,2,3,4,5,6,7,8,9]:[9,8,7,6,5,4,3,2,1],rankNumbers=flipped?[9,8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8,9];
 $('files').replaceChildren(...files.map(n=>node('span','',n)));$('ranks').replaceChildren(...rankNumbers.map(n=>node('span','',ranks[n-1])));
 const from=last&&!last.includes('*')?last.slice(0,2):null,to=last?last.slice(2,4):null;
 const board=$('board');board.replaceChildren();for(const rank of rankNumbers)for(const file of files){const sq=new Square(file,rank),pc=p.board.at(sq),usi=file+String.fromCharCode(96+rank);const cell=node('div','square'+(usi===from?' last-from':'')+(usi===to?' last-to':'')+(pc?.type==='king'&&pc.color===p.color&&p.checked?' checked-king':''));cell.setAttribute('role','gridcell');cell.setAttribute('aria-label',file+ranks[rank-1]+(pc?' '+(pc.color==='black'?'先手':'後手')+' '+names[pc.type]:' 空'));if(pc){const piece=node('span','piece'+(pc.color===top?' rotated':'')+(promoted.has(pc.type)?' promoted':'')+(names[pc.type].length>1?' long':''),names[pc.type]);piece.setAttribute('aria-hidden','true');cell.append(piece);}board.append(cell);}
 $('position-label').textContent=variation?'読みの局面 · 実対局とは別':(index?index+'手目 '+g.moves[index-1].label:'開始局面')+(p.checked?' · 王手':'');
 $('variation-bar').hidden=!variation;if(variation){$('variation-label').textContent=variation.row.ply+'手目を考えた読み · '+variation.step+' / '+variation.pv.length+'手先';$('pv-back').disabled=variation.step===0;$('pv-next').disabled=variation.step===variation.pv.length;}
}
function preview(row,pv,step,candidateIndex){stop();variation={row,pv,step,candidateIndex};render();$('board').scrollIntoView({block:'center',behavior:'smooth'});}
function renderReading(){
 const row=game().moves[index-1],a=row?.analysis;$('candidates').replaceChildren();$('metrics').replaceChildren();
 if(!row){$('reading-engine').textContent='';$('reading-move').textContent='初期局面から観戦できます。';$('score-note').textContent='';$('reading-note').textContent='再生すると、指した時点の評価と読み筋を表示します。';return;}
 $('reading-engine').textContent=row.engine==='lab'?'自作AI v0.4':'やねうら王';$('reading-move').textContent=row.ply+'手目 '+row.label;
 for(const [label,value]of [['実際の思考時間',fmtMs(row.wallMs)],['完了した深さ',(a?.depth??'—')+'手'],['評価',scoreText(a)]]){const n=node('div','metric');n.append(node('span','',label),node('strong','',value));$('metrics').append(n);}
 $('score-note').textContent=(row.side==='black'?'先手':'後手')+'（'+engineName(row.side,true)+'）から見た着手前の評価。'+(row.engine==='lab'?'駒得中心の評価です。':'NNUEの評価です。')+(a?.bound?' * は境界値。':'');
 const root=Position.newBySFEN(row.beforeSfen);
 for(const [ci,c]of (a?.candidates||[]).entries()){
  const wrap=node('div','candidate'),head=node('div','candidate-head');head.append(node('strong','',c.rank+'. '+moveLabel(root,c.move)),node('span','',scoreText({...a,type:row.engine==='lab'?(Math.abs(c.score)>=99000?'lab-mate':'cp'):a.type},c.score)));
  const line=node('div','candidate-line');for(const [i,m]of checkedPV(root,c.pv).entries()){const button=node('button','pv-chip'+(variation?.candidateIndex===ci&&variation.step===i+1?' selected':''),m.label);button.setAttribute('aria-label','候補'+c.rank+'の'+(i+1)+'手先 '+m.label+'を盤面で見る');button.onclick=()=>preview(row,c.pv,i+1,ci);line.append(button);}wrap.append(head,line);$('candidates').append(wrap);
 }
 $('reading-note').textContent=row.engine==='lab'?'3秒内に順位を確定できた上位'+(a?.candidates?.length||0)+'候補。手順を押すと、その読みを盤面で確認できます。':'実際に指した手の読み筋。手順を押すと盤面で確認できます。';
}
function renderList(){
 const list=$('move-list');list.replaceChildren();const start=node('li');const startButton=node('button','move-row'+(index===0?' current':''),'開始局面');startButton.onclick=()=>go(0);start.append(startButton);list.append(start);
 game().moves.forEach((row,i)=>{const li=node('li'),b=node('button','move-row'+(index===i+1?' current':index<i+1?' future':''));b.setAttribute('aria-label',row.ply+'手目 '+row.label+' '+fmtMs(row.wallMs));if(index===i+1)b.setAttribute('aria-current','step');const label=node('span','move-name');label.append(node('span','move-num',row.ply),node('span','',row.label));b.append(label,node('span','move-time',fmtMs(row.wallMs)));b.onclick=()=>go(i+1);li.append(b);list.append(li);});
 const current=list.querySelector('.current');if(current){list.scrollTop=Math.max(0,current.offsetTop-list.offsetTop-list.clientHeight/2);}
}
function render(){
 if(!game())return;renderBoard();renderReading();renderList();$('ply-count').textContent=index+'手目';$('total-plies').textContent='全'+game().moves.length+'手';$('timeline').max=game().moves.length;$('timeline').value=index;
 $('first').disabled=$('previous').disabled=index===0;$('next').disabled=$('last').disabled=index===game().moves.length;
 $('play').textContent=playing?'Ⅱ 一時停止':index===game().moves.length?'↻ 最初から再生':'▶ 観戦を再生';$('quick-play').textContent=playing?'Ⅱ 停止':'▶ 再生';
 $('result').hidden=index!==game().moves.length||!!variation||game().status!=='finished';if(!$('result').hidden){const r=resultText(game());$('result').replaceChildren(node('strong','',r.title),node('span','',r.description));}
}
function stop(){playing=false;clearTimeout(timer);timer=null;}
function go(n){stop();index=Math.max(0,Math.min(game().moves.length,n));variation=null;render();}
function schedule(){
 clearTimeout(timer);if(!playing)return;if(index>=game().moves.length){stop();render();return;}
 const choice=$('speed').value,delay=choice==='actual'?Math.max(120,game().moves[index].wallMs):Number(choice);
 timer=setTimeout(()=>{if(!playing)return;index++;variation=null;render();schedule();},delay);
}
$('play').onclick=()=>{if(!game())return;if(playing){stop();render();return;}if(index>=game().moves.length)index=0;variation=null;playing=true;render();schedule();};
$('quick-play').onclick=()=>$('play').click();
$('first').onclick=()=>go(0);$('previous').onclick=()=>go(index-1);$('next').onclick=()=>go(index+1);$('last').onclick=()=>go(game().moves.length);
$('timeline').oninput=e=>go(Number(e.target.value));$('speed').onchange=()=>schedule();$('flip').onclick=()=>{if(!game())return;flipped=!flipped;renderBoard();};
$('game-select').onchange=e=>{gameIndex=Number(e.target.value);go(0);};
$('pv-back').onclick=()=>{if(variation){variation.step=Math.max(0,variation.step-1);render();}};
$('pv-next').onclick=()=>{if(variation){variation.step=Math.min(variation.pv.length,variation.step+1);render();}};
$('return-record').onclick=()=>{variation=null;render();};
$('download').onclick=()=>{const g=game(),r=resultText(g);const text='先手：'+engineName('black')+'\n後手：'+engineName('white')+'\n'+exportGame({initial:g.initial,moves:g.moves.map(m=>m.usi),result:r.title+' / '+r.description});const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='search-lab-vs-yaneuraou-'+g.id+'.kif';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('keydown',e=>{if(!game()||/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A/.test(e.target.tagName)||e.altKey||e.metaKey||e.ctrlKey)return;if(e.key==='ArrowLeft'){e.preventDefault();go(index-1);}if(e.key==='ArrowRight'){e.preventDefault();go(index+1);}if(e.code==='Space'){e.preventDefault();$('play').click();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stop();render();}});
window.addEventListener('pagehide',stop);
try{
 const r=await fetch('./arena-data.json',{cache:'no-store'});if(!r.ok)throw Error('対局データを読み込めませんでした。');data=await r.json();if(data.schema!==1||!data.games?.length)throw Error('対局データがまだありません。');
 $('game-select').replaceChildren(...data.games.map((g,i)=>{const o=node('option','','第'+(i+1)+'局 · 自作AIが'+(g.labSide==='black'?'先手':'後手'));o.value=i;return o;}));
 for(const id of ['game-select','timeline','play','download','quick-play'])$(id).disabled=false;render();
 if(data.status==='error')throw Error('対局の記録が途中で停止しています。完了済みの手まで表示しています。');
}catch(e){$('error').textContent=e.message+' ページを再読み込みしてください。';$('error').hidden=false;}
