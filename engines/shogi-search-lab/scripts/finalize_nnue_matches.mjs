// Reconcile the status fields with completed logs, independent replay and KIFs.
// Never changes a recorded move, evaluation or timing measurement.
import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,lab,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,parseRecord} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.8',path=dir+'/matches.json',m=JSON.parse(readFileSync(path));
const logs=readFileSync(dir+'/match-log.txt','utf8').trim().split('\n').map(l=>JSON.parse(l));
const boardSfen=s=>s.split(' ').slice(0,3).join(' ');
const audit={beforeSha256:hash(path),originalStatus:m.status,moves:0,pvMoves:0,games:[]};
for(const g of m.games){
 const record=recordAt(g.initial,g.opening);const initial=record.position.sfen;
 for(const r of g.moves){
  if(boardSfen(record.position.sfen)!==boardSfen(r.beforeSfen))throw Error('Before SFEN mismatch');
  if(checkedPV(record.position,r.analysis.pv||[]).length!==(r.analysis.pv||[]).length)throw Error('PV mismatch');
  audit.pvMoves+=(r.analysis.pv||[]).length;
  const move=record.position.createMoveByUSI(r.usi);if(!move||!record.position.isValidMove(move)||!record.append(move))throw Error('Illegal move');
  if(boardSfen(record.position.sfen)!==boardSfen(r.afterSfen))throw Error('After SFEN mismatch');audit.moves++;
 }
 const state=await lab([...g.opening,...g.moves.map(r=>r.usi)],['--legal'],g.initial);
 if(state.moves.length||!state.in_check||hasLegalMove(record.position))throw Error('Expected confirmed checkmate for '+g.id);
 const terminal={reason:'checkmate',winner:record.position.color==='black'?'white':'black'};
 const logged=logs.find(l=>l.game===g.id&&l.result);
 if(!logged||logged.plies!==g.moves.length||JSON.stringify(logged.result)!==JSON.stringify(terminal))throw Error('Terminal log mismatch');
 const kif=parseRecord(readFileSync(dir+'/'+g.id+'.kif','utf8'));
 if(JSON.stringify(kif.moves)!==JSON.stringify(g.moves.map(r=>r.usi)))throw Error('KIF moves mismatch');
 // KIF may reset the move counter; compare the board, side and hands.
 if(kif.initial.split(' ').slice(0,3).join(' ')!==initial.split(' ').slice(0,3).join(' '))throw Error('KIF initial board mismatch');
 audit.games.push({id:g.id,originalStatus:g.status,originalResult:g.result,verifiedResult:terminal,moves:g.moves.length});
 g.result=terminal;g.status='finished';
}
if(m.games.length!==m.plans.length)throw Error('Missing planned game');
m.status='finished';writeFileSync(path,JSON.stringify(m,null,2));audit.afterSha256=hash(path);audit.passed=true;
writeFileSync(dir+'/finalization-audit.json',JSON.stringify(audit,null,2));
console.log(JSON.stringify({passed:true,games:m.games.length,moves:audit.moves,pvMoves:audit.pvMoves}));
