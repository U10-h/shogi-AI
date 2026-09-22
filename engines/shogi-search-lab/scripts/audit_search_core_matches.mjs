// Independently replay complete games, including the resumed prefix and fallback.
import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,START,lab,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,parseRecord} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.9',path=dir+'/matches.json',data=JSON.parse(readFileSync(path));
const previous=data.resumed?JSON.parse(readFileSync(dir+'/matches-before-resume.json')):null;
if(data.status!=='finished'||data.games.length!==4)throw Error('Incomplete matches');
const report={passed:true,matchSha256:hash(path),moves:0,pvMoves:0,fallbacks:{old:0,final:0},games:[]};
for(const game of data.games) {
 const before=previous?.games.find(g=>g.id===game.id);
 if(before&&JSON.stringify(game.moves.slice(0,before.moves.length))!==JSON.stringify(before.moves))throw Error('Resume altered recorded prefix');
 const record=recordAt(START,game.opening),prefix=[...game.opening];
 for(const entry of game.moves) {
  if(checkedPV(record.position,entry.analysis.pv).length!==entry.analysis.pv.length)throw Error('Illegal PV');
  report.pvMoves+=entry.analysis.pv.length;report.moves++;
  if(entry.fallback) {
   const state=await lab(prefix,['--legal']);
   if(entry.analysis.has_result||entry.analysis.pv.length||state.moves[0]!==entry.usi)throw Error('Invalid fallback');
   report.fallbacks[entry.variant]++;
  }else if(entry.analysis.bestmove!==entry.usi)throw Error('Wrong recorded best move');
  const m=record.position.createMoveByUSI(entry.usi);
  if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Illegal played move');
  prefix.push(entry.usi);
 }
 const state=await lab(prefix,['--legal']),r=game.result,side=record.position.color,other=c=>c==='black'?'white':'black';
 if(r.reason==='checkmate'||r.reason==='no-legal-move') {
  if(hasLegalMove(record.position)||state.moves.length||r.winner!==other(side)||state.in_check!==(r.reason==='checkmate'))throw Error('Wrong terminal outcome');
 }else if(r.reason==='move-limit') {
  if(game.moves.length!==game.maxPlies||!r.unresolved||!hasLegalMove(record.position)||record.repetition)throw Error('Wrong unresolved game');
 }else if(r.reason==='repetition'||r.reason==='perpetual-check') {
  if(!record.repetition)throw Error('Missing repetition');
  const checker=record.perpetualCheck;
  if((checker===null?null:other(checker))!==r.winner)throw Error('Wrong repetition result');
 }else throw Error('Unexpected result reason');
 const kif=parseRecord(readFileSync(dir+'/'+game.id+'.kif','utf8'));
 if(JSON.stringify(kif.moves)!==JSON.stringify(game.moves.map(m=>m.usi)))throw Error('KIF mismatch');
 report.games.push({id:game.id,moves:game.moves.length,result:r,prefixPreserved:before?true:null});
}
writeFileSync(dir+'/match-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
