import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ROOT} from './arena_lib.mjs';
const core=process.env.TSSHOGI_CORE||ROOT+'/scripts/record_helpers.mjs';
const {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord,moveLabel}=await import(pathToFileURL(core));
const d=JSON.parse(readFileSync(ROOT+'/results/v0.6/matches.json','utf8'));
assert.equal(d.status,'finished');assert.equal(d.games.length,4);
const positionKey=s=>s.split(' ').slice(0,3).join(' ');
const summary={independentImplementation:'tsshogi via record_helpers.mjs',games:[],moves:0,pvLines:0,pvMoves:0,passed:false};
for(const g of d.games){
 const r=recordAt(g.initial,[]);assert.equal(g.status,'finished');
 for(const m of g.moves){
  assert.equal(positionKey(m.beforeSfen),positionKey(r.position.sfen));assert.equal(Number(m.beforeSfen.split(' ')[3]),m.ply);assert.equal(m.side,r.position.color);
  assert.equal(m.engine,m.side===g.labSide?'lab':'yaneuraou');
  const move=r.position.createMoveByUSI(m.usi);assert(move&&r.position.isValidMove(move));
  m.label=moveLabel(r.position,m.usi);
  for(const c of m.analysis?.candidates||[]){
   const pv=checkedPV(r.position,c.pv);assert.equal(pv.length,c.pv.length);
   assert.equal(c.pv[0],c.move);summary.pvLines++;summary.pvMoves+=pv.length;
  }
  assert.equal(m.analysis.candidates[0].move,m.usi);
  assert(r.append(move));assert.equal(positionKey(m.afterSfen),positionKey(r.position.sfen));assert.equal(Number(m.afterSfen.split(' ')[3]),m.ply+1);assert.equal(m.check,r.position.checked);summary.moves++;
 }
 assert.equal(g.result.reason,'checkmate');assert(r.position.checked);assert.equal(hasLegalMove(r.position),false);
 assert.equal(g.result.winner,r.position.color==='black'?'white':'black');
 const kif='先手：'+(g.labSide==='black'?'Search Lab v0.5 '+g.preset:'YaneuraOu 6.03')+'\n後手：'+(g.labSide==='white'?'Search Lab v0.5 '+g.preset:'YaneuraOu 6.03')+'\n'+exportGame({initial:g.initial,moves:g.moves.map(m=>m.usi),result:'やねうら王の勝ち / 詰み'});
 assert.deepEqual(parseRecord(kif).moves,g.moves.map(m=>m.usi));
 writeFileSync(ROOT+'/results/v0.6/'+g.id+'.kif',kif);
 summary.games.push({id:g.id,plies:g.moves.length,independentlyCheckedMate:true,kifRoundTrip:true});
}
summary.passed=true;writeFileSync(ROOT+'/results/v0.6/verification.json',JSON.stringify(summary,null,2));
// A labelled presentation copy; preserve the original match recorder's output.
writeFileSync(ROOT+'/results/v0.6/arena-labelled.json',JSON.stringify(d,null,2));
console.log(JSON.stringify(summary,null,2));
