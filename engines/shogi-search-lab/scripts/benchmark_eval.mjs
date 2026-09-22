import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,BIN,START,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.7';
const data=JSON.parse(readFileSync(dir+'/training-games.json'));
const frozen=JSON.parse(readFileSync(dir+'/frozen-model.json'));
const variants=['material','positional','learned'];
const model=ROOT+'/experiments/positional-v0.7.txt';
if(hash(model)!==frozen.modelSha256)throw Error('Model changed after freeze');
const result={schema:1,status:'running',binarySha256:hash(BIN),frozen,rows:[]};
const save=()=>writeFileSync(dir+'/comparison.json',JSON.stringify(result,null,2));
const teacher=await yaneura(dir+'/comparison-protocol.jsonl');
try{
 let n=0;
 for(const game of data.games.filter(g=>g.split==='test'))for(const offset of [4,12,20,28]){
  const p=game.rows.find(r=>r.offset===offset);if(!p)throw Error('Missing test root');
  const row={group:game.id,offset,prefix:p.prefix,sfen:p.sfen,runs:[]};
  const r=recordAt(START,p.prefix);
  for(const regime of ['depth3','time3000'])for(let j=0;j<3;j++){
   const variant=variants[(n+j)%3];
   const args=['--advanced','--preset','tactical','--eval',variant,'--max-nodes','1000000000'];
   if(variant==='learned')args.push('--eval-model',model);
   if(regime==='depth3')args.push('--depth','3');else args.push('--depth','16','--iterative','--time-ms','3000');
   const a=await lab(p.prefix,args);
   if(!a.has_result||!a.bestmove)throw Error('No result');
   if(checkedPV(r.position,a.pv).length!==a.pv.length)throw Error('Invalid lab PV');
   row.runs.push({regime,variant,...a});
  }
  await teacher.reset();row.teacherUnrestricted=await teacher.search(p.prefix,{depth:12});
  const candidates=[...new Set([row.teacherUnrestricted.move,...row.runs.map(a=>a.bestmove)])];
  await teacher.reset();row.teacher=await teacher.search(p.prefix,{depth:12,searchmoves:candidates,multipv:candidates.length});
  const ranked=new Map();for(const i of row.teacher.infos)if(i.depth===12&&!i.bound&&candidates.includes(i.pv[0]))ranked.set(i.pv[0],i);
  if(ranked.size!==candidates.length)throw Error('Incomplete teacher ranking');
  row.candidateScores=candidates.map(move=>({move,...ranked.get(move)}));
  for(const c of row.candidateScores)if(checkedPV(r.position,c.pv).length!==c.pv.length)throw Error('Invalid teacher PV');
  if(row.candidateScores.every(c=>c.type==='cp')){
   const best=Math.max(...row.candidateScores.map(c=>c.score));
   for(const a of row.runs)a.teacherGap=best-ranked.get(a.bestmove).score;
  }
  result.rows.push(row);save();n++;
  console.log(JSON.stringify({group:row.group,offset,runs:row.runs.map(a=>({mode:a.variant,regime:a.regime,move:a.bestmove,gap:a.teacherGap,depth:a.completed_depth}))}));
 }
 result.status='finished';save();
}catch(e){result.status='error';result.error=e.stack;save();throw e;}finally{teacher.close();}
