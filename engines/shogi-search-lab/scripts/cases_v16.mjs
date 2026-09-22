// Post-hoc illustrative counterexamples, never model-selection data.
import {readFileSync,writeFileSync,mkdirSync}from'node:fs';
import {ROOT,START}from'./arena_lib.mjs';
import {recordAt,moveLabel,exportGame}from'./record_helpers.mjs';
const D=ROOT+'/results/v0.16',read=p=>JSON.parse(readFileSync(p));mkdirSync(D+'/cases',{recursive:true});const report=[];
for(const id of [0,9,10]){
 const x=read(D+'/quality/'+id+'-1000-0.json'),teacher=read(D+'/teacher/'+id+'.json'),position=recordAt(START,x.root.prefix).position;
 const candidates=[];
 for(const name of ['baseline','adaptive','blend','clipped']){
  const r=x.runs.find(r=>r.variant===name),t=teacher.candidates.find(t=>t.move===r.chosenMove);
  const file=`root${id}-${name}.kif`;writeFileSync(D+'/cases/'+file,exportGame({initial:START,moves:[...x.root.prefix,...r.pv],result:'対局結果ではなく探索PVの再生例'}));
  candidates.push({variant:name,move:r.chosenMove,label:moveLabel(position,r.chosenMove),teacherCp:t.score,seldepth:r.stats.selective_depth,pv:r.pv,pvPlies:r.pv.length,iteration:r.completed_depth,iterationUnit:r.iteration_unit,file});
 }
 report.push({id,sfen:x.root.sfen,prefix:x.root.prefix,candidates});
}
writeFileSync(D+'/counterexamples.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.map(x=>({id:x.id,candidates:x.candidates.map(c=>[c.variant,c.label,c.teacherCp])}))));
