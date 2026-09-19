import {Position,Record,Move,Square,Color,PieceType,handPieceTypes,InitialPositionSFEN,formatMove,importKIF,importKI2,importCSA,exportKIF,judgeJishogiDeclaration,JishogiDeclarationRule,JishogiDeclarationResult} from './vendor/tsshogi/index.js';
export {Position,Record,Move,Square,Color,PieceType,handPieceTypes,InitialPositionSFEN};
export const START=InitialPositionSFEN.STANDARD;
export const GOKIGEN=['7g7f','3c3d','2g2f','5c5d','2f2e','8b5b'];
export const other=c=>c===Color.BLACK?Color.WHITE:Color.BLACK;
export const sideName=c=>c===Color.BLACK?'先手':'後手';
export function positionAt(initial,moves){const p=Position.newBySFEN(initial);if(!p)throw Error('局面の形式が正しくありません。');for(const usi of moves){const m=p.createMoveByUSI(usi);if(!m||!p.doMove(m))throw Error('不正な指し手: '+usi);}return p;}
export function recordAt(initial,moves){const r=new Record(Position.newBySFEN(initial));for(const usi of moves){const m=r.position.createMoveByUSI(usi);if(!m||!r.append(m))throw Error('不正な棋譜: '+usi);}return r;}
export function moveLabel(p,usi){const m=p.createMoveByUSI(usi);return m?formatMove(p,m):usi;}
export function legalMoves(p,from){const sources=from!==undefined?[from]:[...p.board.listSquaresByColor(p.color),...handPieceTypes.filter(t=>p.hand(p.color).count(t)>0)];const out=[];for(const source of sources)for(let rank=1;rank<=9;rank++)for(let file=1;file<=9;file++){const m=p.createMove(source,new Square(file,rank));if(!m)continue;if(p.isValidMove(m))out.push(m);const pr=m.withPromote();if(p.isValidMove(pr))out.push(pr);}return out;}
export function hasLegalMove(p){
  const sources=[...p.board.listSquaresByColor(p.color),...handPieceTypes.filter(t=>p.hand(p.color).count(t)>0)];
  for(const from of sources)for(let rank=1;rank<=9;rank++)for(let file=1;file<=9;file++){const m=p.createMove(from,new Square(file,rank));if(m&&(p.isValidMove(m)||p.isValidMove(m.withPromote())))return true;}
  return false;
}
export function statusOfRecord(r){if(r.repetition){return r.perpetualCheck?sideName(r.perpetualCheck)+'の連続王手の千日手（反則負け）':'千日手・引き分け';}if(!hasLegalMove(r.position))return sideName(r.position.color)+'の負け（指せる手がありません）';return null;}
export function statusOf(initial,moves){return statusOfRecord(recordAt(initial,moves));}
export function parseInfo(line){if(!line.startsWith('info ')||!line.includes(' pv '))return null;const pv=line.split(' pv ')[1].trim().split(/\s+/).filter(x=>/^(?:[1-9][a-i]|[PLNSGBR]\*)[1-9][a-i]\+?$/.test(x));const get=k=>{const m=line.match(new RegExp('(?:^| )'+k+' (-?\\d+)'));return m?Number(m[1]):null;};const score=line.match(/score (cp|mate) (-?\d+)/);if(!pv.length||!score)return null;return {rank:get('multipv')||1,depth:get('depth')||0,nodes:get('nodes')||0,time:get('time')||0,type:score[1],score:Number(score[2]),bound:/\b(lowerbound|upperbound)\b/.test(line),pv};}
export function checkedPV(p,pv){const copy=p.clone(),out=[];for(const usi of pv){const m=copy.createMoveByUSI(usi);if(!m||!copy.isValidMove(m))break;out.push({usi,label:formatMove(copy,m)});copy.doMove(m);}return out;}
export function scoreLabel(info){if(info.terminal)return info.terminal;if(info.type==='mate')return info.score>0?'詰み手順 +'+info.score:'被詰み '+Math.abs(info.score);return (info.score>0?'+':'')+info.score+(info.bound?'（境界値）':'');}
export function newGame({human='black',opening='standard',clockMode='learning',thinkTime=3000,backgroundCoaching=true}={}){return {version:1,id:Date.now()+'-'+Math.random().toString(36).slice(2,7),initial:START,moves:opening==='gokigen'?[...GOKIGEN]:[],human:opening==='gokigen'?'white':human,opening,clockMode,thinkTime,clocks:{black:600000,white:600000},clockHistory:[],variations:[],result:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),assistance:0,teachingNotes:[],teacherPending:null,backgroundCoaching};}
export function validateGame(g){if(!g||g.version!==1||!['black','white'].includes(g.human)||!['learning','match','unlimited'].includes(g.clockMode)||!Array.isArray(g.moves)||g.moves.length>2000||!g.clocks||!['black','white'].every(c=>Number.isFinite(g.clocks[c])&&g.clocks[c]>=0)||![1000,3000,5000,10000,30000].includes(g.thinkTime))throw Error('バックアップの形式が正しくありません。');positionAt(g.initial,g.moves);if(!Array.isArray(g.variations))g.variations=[];if(g.variations.length>100)throw Error('変化が多すぎます。');for(const v of g.variations){if(!Array.isArray(v.moves)||v.moves.length>2000||typeof v.label!=='string')throw Error('変化の形式が正しくありません。');positionAt(v.initial,v.moves);}g.clockHistory=Array.isArray(g.clockHistory)?g.clockHistory:[];if(g.clockHistory.length>2000||g.clockHistory.some(c=>c!==null&&(!c||!['black','white'].every(side=>Number.isFinite(c[side])&&c[side]>=0))))throw Error('時計の履歴が不正です。');if(g.result!==null&&typeof g.result!=='string')throw Error('対局結果が不正です。');g.assistance=Number.isFinite(g.assistance)?g.assistance:0;
  g.teachingNotes=Array.isArray(g.teachingNotes)?g.teachingNotes.slice(-40).filter(n=>n&&Number.isInteger(n.ply)&&n.ply>=1&&typeof n.move==='string'&&typeof n.goal==='string'&&typeof n.note==='string').map(n=>({ply:n.ply,move:n.move.slice(0,5),grade:String(n.grade||'').slice(0,20),goal:n.goal.slice(0,160),note:n.note.slice(0,400),action:n.action==='retry'?'retry':'continue'})):[];
  if(!g.teacherPending||!Number.isInteger(g.teacherPending.ply)||g.teacherPending.ply<1||g.teacherPending.ply>g.moves.length||g.teacherPending.move!==g.moves[g.teacherPending.ply-1])g.teacherPending=null;
  g.backgroundCoaching=g.backgroundCoaching!==false;
  if(g.redo){
    const r=g.redo,clock=c=>c&&['black','white'].every(s=>Number.isFinite(c[s])&&c[s]>=0);
    if(!Array.isArray(r.moves)||r.moves.length>2000||r.moves.length<=g.moves.length||!g.moves.every((m,i)=>m===r.moves[i])||!clock(r.clocks)||!Array.isArray(r.clockHistory)||r.clockHistory.length>2000||r.clockHistory.some(c=>c!==null&&!clock(c))||r.result!==null&&typeof r.result!=='string')throw Error('進む手順の保存データが不正です。');
    positionAt(g.initial,r.moves);
  }else g.redo=null;
  return g;}

// The active moves remain a legal prefix. Keep the complete future and clocks
// until a new move actually commits, including across reload / JSON export.
export function rewindGame(g,target){
  if(!Number.isInteger(target)||target<0||target>=g.moves.length)return false;
  g.redo ||= {moves:[...g.moves],clocks:structuredClone(g.clocks),clockHistory:structuredClone(g.clockHistory),result:g.result};
  g.clocks=structuredClone(g.redo.clockHistory[target]||g.clocks);
  g.moves=g.moves.slice(0,target);g.clockHistory=g.clockHistory.slice(0,target);g.result=null;g.teacherPending=null;g.assistance++;
  return true;
}
export function forwardGame(g){
  const r=g.redo;if(!r||!g.moves.every((m,i)=>m===r.moves[i]))return false;
  const target=g.moves.length+1;if(target>r.moves.length)return false;
  g.moves=r.moves.slice(0,target);g.clockHistory=structuredClone(r.clockHistory.slice(0,target));
  g.clocks=structuredClone(target===r.moves.length?r.clocks:r.clockHistory[target]||g.clocks);
  g.result=target===r.moves.length?r.result:null;g.teacherPending=null;g.assistance++;
  if(target===r.moves.length)g.redo=null;
  return true;
}
export function forkHistory(g){
  if(!g.redo)return;
  g.variations.push({label:'指し直す前の手順 · '+g.redo.moves.length+'手',initial:g.initial,moves:[...g.redo.moves]});
  g.variations=g.variations.slice(-30);g.redo=null;
}
export function exportGame(g){const r=recordAt(g.initial,g.moves);r.first.comment=g.result?'結果: '+g.result:'';return exportKIF(r);}
export function parseRecord(text){text=text.trim();if(text.length>2_000_000)throw Error('棋譜が大きすぎます。');if(text.startsWith('{')){const parsed=JSON.parse(text);return {game:validateGame(parsed.game||parsed)};}
  if(text.startsWith('position ')){const parts=text.replace(/^position /,'').split(/\s+moves\s+/);const initial=parts[0]==='startpos'?START:parts[0].replace(/^sfen /,'');const moves=parts[1]?parts[1].trim().split(/\s+/):[];positionAt(initial,moves);return {initial,moves};}
  if(/^(?:sfen )?[lnsgkprbLNSGKPRB1-9+\/]+ [bw] /.test(text)){const initial=text.replace(/^sfen /,'');positionAt(initial,[]);return {initial,moves:[]};}
  let r;if(text.startsWith('V')||text.startsWith('N+')||text.startsWith('PI')||/^P[1-9]/m.test(text))r=importCSA(text);else{r=importKIF(text);if(r instanceof Error)r=importKI2(text);}if(r instanceof Error)throw r;const initial=r.initialPosition.sfen,moves=[];r.goto(0);while(r.goForward()){if(r.current.move instanceof Move)moves.push(r.current.move.usi);}positionAt(initial,moves);return {initial,moves};
}
const values={pawn:100,lance:300,knight:300,silver:400,gold:500,bishop:700,rook:800,king:0,promPawn:500,promLance:500,promKnight:500,promSilver:500,horse:900,dragon:1000};
export function material(p,color){let total=0;for(const sq of p.board.listNonEmptySquares()){const pc=p.board.at(sq);total+=(pc.color===color?1:-1)*(values[pc.type]||0);}for(const c of ['black','white'])for(const type of handPieceTypes)total+=(c===color?1:-1)*p.hand(c).count(type)*values[type];return total;}
export function describeLine(p,info){const line=checkedPV(p,info.pv);if(!line.length)return '再解析してください。';const end=positionAt(p.sfen,line.map(m=>m.usi));const delta=material(end,p.color)-material(p,p.color);const first=p.createMoveByUSI(line[0].usi);const after=positionAt(p.sfen,[line[0].usi]);const facts=[];if(first.capturedPieceType)facts.push('最初の手で駒を取ります。');if(first.promote)facts.push('最初の手で駒を成ります。');if(after.checked)facts.push('相手玉への王手です。');facts.push('表示した'+line.length+'手先までの駒の収支は、現在の手番側から見て'+(delta>0?'＋':'')+delta+'点です（歩を100点とした単純集計）。');facts.push('駒の収支だけでは形勢は決まりません。相手の応手を一手ずつ進め、玉の安全と次の狙いを確かめましょう。');return facts.join('\n');}

export function declarationWins(p,color=p.color){return judgeJishogiDeclaration(JishogiDeclarationRule.GENERAL27,p,color)===JishogiDeclarationResult.WIN;}
export function validateAnalysisPosition(p){
 const totals={pawn:0,lance:0,knight:0,silver:0,gold:0,bishop:0,rook:0,king:0};const kings={black:0,white:0};
 for(const sq of p.board.listNonEmptySquares()){const pc=p.board.at(sq);totals[pc.unpromoted().type]++;if(pc.type===PieceType.KING)kings[pc.color]++;}
 for(const c of ['black','white'])for(const type of handPieceTypes)totals[type]+=p.hand(c).count(type);
 if(kings.black!==1||kings.white!==1)throw Error('解析には先手・後手の玉が1枚ずつ必要です。');
 const limits={pawn:18,lance:4,knight:4,silver:4,gold:4,bishop:2,rook:2,king:2};
 if(Object.entries(totals).some(([type,n])=>n>limits[type]))throw Error('駒の枚数が通常より多いため解析できません。');
 if(p.board.isChecked(other(p.color)))throw Error('手番ではない側の玉が王手になっています。手番または局面を確認してください。');
 return p;
}
