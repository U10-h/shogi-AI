// Replay/export helpers using the separately vendored MIT tsshogi rules engine.
import {Position,Record,Move,Square,handPieceTypes,formatMove,importKIF,exportKIF} from '../vendor/tsshogi/index.js';
export function recordAt(initial,moves){
 const p=Position.newBySFEN(initial);if(!p)throw Error('Invalid SFEN');
 const record=new Record(p);
 for(const usi of moves){const m=record.position.createMoveByUSI(usi);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Illegal move '+usi);}
 return record;
}
export function moveLabel(p,usi){const m=p.createMoveByUSI(usi);if(!m)throw Error('Invalid move '+usi);return formatMove(p,m);}
export function checkedPV(p,moves){
 const copy=p.clone(),out=[];
 for(const usi of moves){const m=copy.createMoveByUSI(usi);if(!m||!copy.isValidMove(m))break;out.push({usi,label:formatMove(copy,m)});copy.doMove(m);}
 return out;
}
export function hasLegalMove(p){
 const sources=[...p.board.listSquaresByColor(p.color),...handPieceTypes.filter(t=>p.hand(p.color).count(t)>0)];
 for(const from of sources)for(let rank=1;rank<=9;rank++)for(let file=1;file<=9;file++){
  const m=p.createMove(from,new Square(file,rank));if(m&&(p.isValidMove(m)||p.isValidMove(m.withPromote())))return true;
 }
 return false;
}
export function exportGame(g){const r=recordAt(g.initial,g.moves);r.first.comment=g.result?'結果: '+g.result:'';return exportKIF(r);}
export function parseRecord(text){
 const r=importKIF(text);if(r instanceof Error)throw r;
 const initial=r.initialPosition.sfen,moves=[];r.goto(0);
 while(r.goForward())if(r.current.move instanceof Move)moves.push(r.current.move.usi);
 recordAt(initial,moves);return {initial,moves};
}
