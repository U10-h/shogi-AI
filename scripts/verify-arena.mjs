import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {START,recordAt,checkedPV,hasLegalMove,parseRecord} from '../dist/core.js';
const d=JSON.parse(readFileSync('dist/arena-data.json','utf8'));
assert.equal(d.status,'finished');assert.equal(d.settings.timeMs,3000);assert.equal(d.games.length,2);
const summary={games:[],moves:0,pvLines:0,pvMoves:0,sourceHashes:true,passed:false};
for(const [path,hash]of Object.entries(d.settings.lab.sourceFilesSha256))assert.equal(createHash('sha256').update(readFileSync('engines/shogi-search-lab/'+path)).digest('hex'),hash);
for(const g of d.games){
 const r=recordAt(START,[]);assert.equal(g.status,'finished');
 for(const m of g.moves){
  assert.equal(m.beforeSfen,r.position.sfen);assert.equal(m.side,r.position.color);assert.equal(m.engine,m.side===g.labSide?'lab':'yaneuraou');assert(m.wallMs>=0&&m.wallMs<5000);
  const p=r.position,move=p.createMoveByUSI(m.usi);assert(move&&p.isValidMove(move));
  for(const c of m.analysis.candidates){const pv=checkedPV(p,c.pv);assert.equal(pv.length,c.pv.length);assert.equal(c.pv[0],c.move);summary.pvLines++;summary.pvMoves+=pv.length;}
  if(m.engine==='lab'){assert.equal(m.analysis.candidates[0].move,m.usi);assert(m.analysis.candidates.length>=1&&m.analysis.candidates.length<=5);assert(m.analysis.candidates.every(c=>c.depth===m.analysis.depth));assert.equal(m.analysis.stopReason,'time_limit');}
  assert(r.append(move));assert.equal(m.afterSfen,r.position.sfen);summary.moves++;
 }
 assert.equal(g.result.reason,'checkmate');assert(r.position.checked);assert.equal(hasLegalMove(r.position),false);assert.equal(g.result.winner,r.position.color==='black'?'white':'black');
 const kif=parseRecord(readFileSync('docs/arena/'+g.id+'.kif','utf8'));assert.deepEqual(kif.moves,g.moves.map(m=>m.usi));
 summary.games.push({id:g.id,plies:g.moves.length,result:g.result,independentlyCheckedMate:true,kifRoundTrip:true});
}
summary.passed=true;writeFileSync('docs/arena/verification.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
