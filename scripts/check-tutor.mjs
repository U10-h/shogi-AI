import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateTutorReply} from '../dist/tutor.js';

// These are authored regression cases for the validator, not model generations
// and not a measurement of Japanese teaching quality or shogi strength.
const fixture=JSON.parse(readFileSync(new URL('../docs/experiments/tutor-regression-cases.json',import.meta.url),'utf8'));
const compare=process.argv.indexOf('--baseline'),baseline=compare>=0?process.argv[compare+1]:null;
const validators={current:validateTutorReply};let baselineCommit=null;
if(baseline){
  baselineCommit=execFileSync('git',['rev-parse','--verify',baseline+'^{commit}'],{encoding:'utf8'}).trim();
  const source=execFileSync('git',['show',baselineCommit+':dist/tutor.js'],{encoding:'utf8'}).replaceAll("'./coach-analysis.js'",JSON.stringify(new URL('../dist/coach-analysis.js',import.meta.url).href));
  validators.baseline=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).validateTutorReply;
}
const rows=fixture.cases.map(c=>{
  const row={id:c.id,expectedAcceptance:c.accept};
  for(const [name,validate]of Object.entries(validators)){
    try{validate(JSON.stringify({answer:c.answer,evidence_ids:c.ids}),fixture.evidence);row[name]=true;}catch{row[name]=false;}
  }
  return row;
});
const summary=Object.fromEntries(Object.keys(validators).map(name=>[name,{correct:rows.filter(r=>r[name]===r.expectedAcceptance).length,total:rows.length,wrongAccepted:rows.filter(r=>!r.expectedAcceptance&&r[name]).length,groundedRejected:rows.filter(r=>r.expectedAcceptance&&!r[name]).length}]));
const files=['tutor.js','tutor-grounding.js','tutor-generation.js','tutor-worker.js','tutor-prompt.js'];
const sourceHash=createHash('sha256').update(files.map(f=>f+'\n'+readFileSync(new URL('../dist/'+f,import.meta.url),'utf8')).join('\n')).digest('hex');
writeFileSync(new URL('../docs/experiments/tutor-reliability.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),scope:fixture.description,baselineCommit,sourceHash,summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.current.correct!==summary.current.total)process.exitCode=1;
