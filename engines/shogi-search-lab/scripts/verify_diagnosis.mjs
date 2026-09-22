import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ROOT,START} from './arena_lib.mjs';
const {recordAt,checkedPV}=await import(pathToFileURL(process.env.TSSHOGI_CORE||ROOT+'/scripts/record_helpers.mjs'));
const d=JSON.parse(readFileSync(ROOT+'/results/v0.6/diagnosis.json','utf8'));
assert.equal(d.status,'finished');assert.equal(d.rows.length,12);
const key=s=>s.split(' ').slice(0,3).join(' ');
const summary={positions:0,uniquePositions:0,labSearches:0,teacherCandidateLines:0,pvMoves:0,passed:false};
for(const row of d.rows){
 const p=recordAt(START,row.prefix).position;assert.equal(key(p.sfen),key(row.sfen));
 for(const v of row.variants){
  assert(v.analysis.has_result);assert.equal(v.analysis.bestmove,v.move);
  assert.equal(v.analysis.pv[0],v.move);
  const pv=checkedPV(p,v.analysis.pv);assert.equal(pv.length,v.analysis.pv.length);
  summary.labSearches++;summary.pvMoves+=pv.length;
 }
 for(const c of row.candidateScores){
  assert.equal(c.depth,12);assert.equal(c.bound,false);assert.equal(c.pv[0],c.move);
  const pv=checkedPV(p,c.pv);assert.equal(pv.length,c.pv.length);
  summary.teacherCandidateLines++;summary.pvMoves+=pv.length;
 }
 summary.positions++;
}
summary.uniquePositions=new Set(d.rows.map(r=>key(r.sfen))).size;summary.passed=true;
writeFileSync(ROOT+'/results/v0.6/diagnosis-verification.json',JSON.stringify(summary,null,2));console.log(summary);
