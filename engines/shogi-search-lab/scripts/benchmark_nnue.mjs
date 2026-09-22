import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,BIN,START,ASSETS,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.8',protocol=JSON.parse(readFileSync(dir+'/protocol.json'));
const result={status:'running',protocolSha256:hash(dir+'/protocol.json'),binarySha256:hash(BIN),modelSha256:hash(ASSETS+'/yaneuraou.data'),games:[],rows:[]};
if(result.modelSha256!==protocol.modelSha256)throw Error('Model mismatch');
const save=()=>writeFileSync(dir+'/quality.json',JSON.stringify(result,null,2));
const teacher=await yaneura(dir+'/quality-protocol.jsonl');
let seed=20260922;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
try{
 // Generate every root before comparing candidates. No result-dependent selection.
 for(let g=0;g<protocol.openings.length;g++){
  const prefix=[...protocol.openings[g]],record=recordAt(START,prefix),game={id:g,opening:[...prefix],moves:[],roots:[]};
  await teacher.reset();
  for(let offset=0;offset<=24;offset++){
   if([8,16,24].includes(offset))game.roots.push({group:g,offset,prefix:[...prefix],sfen:record.position.sfen});
   const a=await teacher.search(prefix,{depth:8,multipv:3});
   const unique=new Map();for(const i of a.infos)if(i.depth===8&&!i.bound)unique.set(i.pv[0],i);
   const all=[...unique.values()].sort((a,b)=>a.rank-b.rank);let move=a.move;
   if(all.length&&all.every(i=>i.type==='cp')){const best=Math.max(...all.map(i=>i.score)),choices=all.filter(i=>i.score>=best-120);move=choices[Math.floor(rand()*choices.length)].pv[0];}
   const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Illegal root-generation move');
   game.moves.push({move,info:all});prefix.push(move);
  }
  result.games.push(game);save();console.log('generated',g);
 }
 let n=0;
 for(const game of result.games)for(const root of game.roots){
  const row={...root,runs:[]},record=recordAt(START,root.prefix);
  for(const mode of n%2?['nnue','positional']:['positional','nnue']){
   const args=['--advanced','--preset','tactical','--eval',mode,'--depth','16','--iterative','--time-ms','3000','--max-nodes','1000000000'];
   if(mode==='nnue')args.push('--eval-model',ASSETS+'/yaneuraou.data');
   const r=await lab(root.prefix,args);if(!r.has_result||!r.bestmove||checkedPV(record.position,r.pv).length!==r.pv.length)throw Error('Invalid candidate PV');
   row.runs.push(r);
  }
  await teacher.reset();row.teacherUnrestricted=await teacher.search(root.prefix,{depth:12});
  const moves=[...new Set([row.teacherUnrestricted.move,...row.runs.map(r=>r.bestmove)])];
  await teacher.reset();row.teacher=await teacher.search(root.prefix,{depth:12,multipv:moves.length,searchmoves:moves});
  const ranked=new Map();for(const i of row.teacher.infos)if(i.depth===12&&!i.bound&&moves.includes(i.pv[0]))ranked.set(i.pv[0],i);
  if(ranked.size!==moves.length)throw Error('Incomplete teacher ranking');
  row.candidateScores=moves.map(move=>({move,...ranked.get(move)}));
  for(const c of row.candidateScores)if(checkedPV(record.position,c.pv).length!==c.pv.length)throw Error('Invalid teacher PV');
  if(row.candidateScores.every(c=>c.type==='cp')){const best=Math.max(...row.candidateScores.map(c=>c.score));for(const r of row.runs)r.teacherGap=best-ranked.get(r.bestmove).score;}
  result.rows.push(row);save();n++;console.log(JSON.stringify({group:row.group,offset:row.offset,runs:row.runs.map(r=>({eval:r.evaluation,gap:r.teacherGap,depth:r.completed_depth,move:r.bestmove}))}));
 }
 result.status='finished';save();
}catch(e){result.status='error';result.error=e.stack;save();throw e;}finally{teacher.close();}
