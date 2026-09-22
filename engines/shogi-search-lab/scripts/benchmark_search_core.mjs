// Paired 3-second move decisions; fixed teacher evaluates their candidate union.
import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,BIN,START,ASSETS,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.9',old=ROOT+'/build/shogi-lab-v0.8';
const protocol=JSON.parse(readFileSync(dir+'/protocol.json'));
if(hash(ASSETS+'/yaneuraou.data')!==protocol.modelSha256)throw Error('Frozen model mismatch');
const roots=JSON.parse(readFileSync(ROOT+'/results/v0.8/quality.json')).rows;
const result={status:'running',protocolSha256:hash(dir+'/protocol.json'),binaries:{old:hash(old),final:hash(BIN)},modelSha256:protocol.modelSha256,rows:[]};
const save=()=>writeFileSync(dir+'/quality.json',JSON.stringify(result,null,2));
const teacher=await yaneura(dir+'/quality-protocol.jsonl');
try {
 for(const [n,root] of roots.entries()) {
  const row={group:root.group,offset:root.offset,prefix:root.prefix,sfen:root.sfen,runs:[]},record=recordAt(START,root.prefix);
  for(const name of n%2?['final','old']:['old','final']) {
   const args=['--advanced','--preset','tactical','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data','--depth','16','--iterative','--time-ms','3000','--max-nodes','1000000000'];
   const r=await lab(root.prefix,args,START,name==='old'?old:BIN);
   if(!r.has_result||!r.bestmove||checkedPV(record.position,r.pv).length!==r.pv.length)throw Error('Invalid PV');
   row.runs.push({variant:name,...r});
  }
  await teacher.reset();row.teacherUnrestricted=await teacher.search(root.prefix,{depth:12});
  const moves=[...new Set([row.teacherUnrestricted.move,...row.runs.map(r=>r.bestmove)])];
  await teacher.reset();row.teacher=await teacher.search(root.prefix,{depth:12,multipv:moves.length,searchmoves:moves});
  const ranked=new Map();for(const i of row.teacher.infos)if(i.depth===12&&!i.bound&&moves.includes(i.pv[0]))ranked.set(i.pv[0],i);
  if(ranked.size!==moves.length)throw Error('Incomplete teacher ranking');
  row.candidateScores=moves.map(move=>({move,...ranked.get(move)}));
  for(const c of row.candidateScores)if(checkedPV(record.position,c.pv).length!==c.pv.length)throw Error('Invalid teacher PV');
  if(row.candidateScores.every(c=>c.type==='cp')) {
   const best=Math.max(...row.candidateScores.map(c=>c.score));
   for(const r of row.runs)r.teacherGap=best-ranked.get(r.bestmove).score;
  }
  result.rows.push(row);save();console.log(JSON.stringify({root:n,runs:row.runs.map(r=>({variant:r.variant,depth:r.completed_depth,move:r.bestmove,gap:r.teacherGap,nodes:r.nodes}))}));
 }
 result.status='finished';save();
}catch(e){result.status='error';result.error=e.stack;save();throw e;}finally{teacher.close();}
