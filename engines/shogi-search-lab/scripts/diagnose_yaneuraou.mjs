import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {ROOT,lab,yaneura} from './arena_lib.mjs';

// A systematic sample, fixed before seeing the re-analysis scores.
// Teacher scores compare candidates inside one MultiPV search, never across engines.
const input=JSON.parse(readFileSync(ROOT+'/results/v0.6/matches.json','utf8'));
if(input.status!=='finished'||input.games.length!==4)throw Error('Finish the four matches first');
const common=['tt','history','killer','counter','mate-distance','qsearch'];
const variants=[{id:'tactical',args:['--preset','tactical']},
 {id:'selective',args:['--preset','selective']},
 {id:'check-extension',args:['--features',[...common,'check-extension'].join(',')]},
 {id:'futility',args:['--features',[...common,'futility'].join(',')]}];
const result={schema:1,status:'running',createdAt:new Date().toISOString(),
 method:{selection:'Own turns 3, 7, 11 in each of four games',labMs:3000,variants,
 teacherDepth:12,teacher:'Same fixed YaneuraOu; one MultiPV search restricted to the union of candidate moves',
 interpretation:'Candidate-set score gaps are heuristic teacher estimates, not exact minimax regret or win-rate improvements.'},rows:[]};
const out=ROOT+'/results/v0.6/diagnosis.json';
const save=()=>{writeFileSync(out+'.tmp',JSON.stringify(result,null,2));renameSync(out+'.tmp',out);};
writeFileSync(ROOT+'/results/v0.6/diagnosis-plan.json',JSON.stringify(result.method,null,2));
const opponent=await yaneura(ROOT+'/results/v0.6/diagnosis-protocol.jsonl');
try{
 for(const g of input.games)for(const ownTurn of [3,7,11]){
  const played=g.moves.filter(m=>m.engine==='lab')[ownTurn-1];
  if(!played)throw Error('Sample position absent');
  const prefix=g.moves.slice(0,played.ply-1).map(m=>m.usi);
  const row={game:g.id,ply:played.ply,ownTurn,sfen:played.beforeSfen,prefix,
   played:{move:played.usi,analysis:played.analysis},material:played.materialBefore,variants:[]};
  // Sequential searches prevent CPU contention between timed measurements.
  for(const v of variants){
   const a=await lab(prefix,['--advanced',...v.args,'--depth','16','--iterative','--time-ms','3000','--max-nodes','1000000000']);
   row.variants.push({id:v.id,move:a.bestmove,analysis:a});
  }
  await opponent.reset();row.teacherUnrestricted=await opponent.search(prefix,{depth:12});
  const candidates=[...new Set([played.usi,row.teacherUnrestricted.move,...row.variants.map(v=>v.move)])];
  await opponent.reset();row.teacher=await opponent.search(prefix,{depth:12,searchmoves:candidates,multipv:candidates.length});
  const ranked=new Map();
  for(const i of row.teacher.infos)if(i.depth===12&&!i.bound&&candidates.includes(i.pv[0]))ranked.set(i.pv[0],i);
  if(ranked.size!==candidates.length||!candidates.includes(row.teacher.move))throw Error('Teacher did not score every restricted candidate at depth 12');
  row.candidateScores=candidates.map(move=>({move,...ranked.get(move)}));
  if(row.candidateScores.every(c=>c.type==='cp')){
   const best=Math.max(...row.candidateScores.map(c=>c.score));
   row.played.teacherGap=best-ranked.get(played.usi).score;
   for(const v of row.variants)v.teacherGap=best-ranked.get(v.move).score;
  }
  result.rows.push(row);save();console.log(JSON.stringify({game:g.id,ply:row.ply,played:row.played.move,gap:row.played.teacherGap,variants:row.variants.map(v=>({id:v.id,move:v.move,gap:v.teacherGap,depth:v.analysis.completed_depth}))}));
 }
 result.status='finished';result.finishedAt=new Date().toISOString();save();
}catch(e){result.status='error';result.error=e.stack;save();throw e;}finally{opponent.close();}
