// v0.11 frozen-model controls, unseen-position replication, and stop handling.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const D=ROOT+'/results/v0.11',mode=process.argv[2],shard=Number(process.argv[3]||0),shards=Number(process.argv[4]||1);
mkdirSync(D,{recursive:true});
const read=p=>JSON.parse(readFileSync(p)),save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
const models={base:ASSETS+'/yaneuraou.data',anchored50:ROOT+'/build/models/v0.10/anchored50.nnue',tempo40:ROOT+'/build/models/v0.10/tempo40.nnue'};
const signatures=Object.fromEntries(Object.entries(models).map(([n,p])=>[n,hash(p)]));
const protocolPath=D+'/protocol.json';
if(mode==='prepare'){
 if(existsSync(protocolPath))throw Error('Protocol already exists');
 save(protocolPath,{version:'v0.11',createdAt:new Date().toISOString(),seed:2026092511,modelHashes:signatures,binarySha256:hash(BIN),training:'No training or model selection. All v0.10 model parameters remain frozen.',data:{games:16,maxPlies:64,depth:6,multipv:3,sampleOffsets:[15,31,47,63],novelty:'Exclude all v0.10 labeled positions and their horizontal mirrors; fresh PRNG trajectories, shared opening families.'},quality:{nodes:[12000,48000],roots:[64,16],teacherDepth:10,commonCandidateUnion:true},matches:{short:{nodes:12000,starts:16,pairs:[['anchored50','base'],['tempo40','base'],['anchored50','tempo40']]},long:{nodes:48000,starts:8,pairs:[['anchored50','base'],['anchored50','tempo40']]},maxPlies:200,fallback:'completed root child if available; otherwise first legal',adjudication:'Only checkmate/no-legal-move/repetition/perpetual-check. Move cap remains unresolved.'},statistics:'Opening trajectory paired cluster bootstrap 5000 replicates; no Elo. No post-outcome model tuning.'});
 console.log('Protocol frozen');process.exit(0);
}
const protocol=read(protocolPath);
if(JSON.stringify(signatures)!==JSON.stringify(protocol.modelHashes)||hash(BIN)!==protocol.binarySha256)throw Error('Frozen implementation/model mismatch');
const openings=['7g7f 3c3d','2g2f 8c8d','7g7f 8c8d','2g2f 3c3d','5g5f 3c3d 2h5h 8c8d','7g7f 3c3d 2h6h 8c8d','7g7f 8c8d 6g6f 3c3d','2g2f 8c8d 2f2e 8d8e','7g7f 3c3d 8h2b+ 3a2b','2g2f 3c3d 7g7f 8c8d','7g7f 3c3d 6g6f 8c8d 2h7h','5g5f 8c8d 2h5h 3c3d','9g9f 3c3d 7g7f 8c8d','7g7f 3c3d 2h4h 8c8d','7g7f 3c3d 9g9f 9c9d 6g6f 4c4d','2g2f 4c4d 7g7f 3c3d'].map(x=>x.split(' '));
function validate(p,m,pv=[]){const move=p.createMoveByUSI(m);if(!move||!p.isValidMove(move)||checkedPV(p,pv).length!==pv.length)throw Error('Illegal move/PV '+m);return move;}
async function run(prefix,name,nodes){
 const r=await lab(prefix,['--advanced','--preset','tactical','--eval','nnue','--eval-model',models[name],'--depth','16','--iterative','--max-nodes',String(nodes)]);
 const chosenMove=r.has_result?r.bestmove:r.fallback_move;
 validate(recordAt(START,prefix).position,chosenMove,r.has_result?r.pv:r.fallback_pv);
 return {variant:name,chosenMove,fallback:!r.has_result,...r};
}
const teacher=['collect','quality','fallback'].includes(mode)?await yaneura(undefined,{allLegalMoves:true}):null;
async function score(prefix,moves){
 const pos=recordAt(START,prefix).position;
 await teacher.reset();const unrestricted=await teacher.search(prefix,{depth:10});
 moves=[...new Set([...moves,unrestricted.move])];
 await teacher.reset();const scored=await teacher.search(prefix,{depth:10,multipv:moves.length,searchmoves:moves});
 const ranked=new Map();for(const i of scored.infos)if(!i.bound&&moves.includes(i.pv[0]))ranked.set(i.pv[0],i);
 if(ranked.size!==moves.length)throw Error('Incomplete teacher candidates');
 const candidates=moves.map(m=>({move:m,...ranked.get(m)}));
 for(const c of candidates){if(c.depth<10&&c.type!=='mate')throw Error('Incomplete teacher depth');validate(pos,c.move,c.pv);}
 return {unrestricted,scored,candidates};
}
try {
 if(mode==='collect'){
  mkdirSync(D+'/games',{recursive:true});
  for(let id=shard;id<16;id+=shards){
   const path=D+'/games/'+String(id).padStart(2,'0')+'.json';if(existsSync(path))continue;
   let seed=(protocol.seed+id*7919)>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
   const prefix=[...openings[id]],record=recordAt(START,prefix),game={id,opening:openings[id],seed,status:'running',rows:[],terminal:null};
   await teacher.reset();
   for(let offset=0;offset<64;offset++){
    if(record.repetition||!hasLegalMove(record.position)){game.terminal={sfen:record.position.sfen,repetition:record.repetition};break;}
    const a=await teacher.search(prefix,{depth:6,multipv:3}),ranks=new Map();for(const i of a.infos)if(!i.bound)ranks.set(i.rank,i);
    const cs=[...ranks.values()].sort((a,b)=>a.rank-b.rank);for(const c of cs)validate(record.position,c.pv[0],c.pv);
    const eligible=cs.filter(c=>c.type==='cp'&&c.score>=cs[0].score-180),move=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
    game.rows.push({game:id,offset,ply:prefix.length,prefix:[...prefix],sfen:record.position.sfen,checked:record.position.checked,candidates:cs,selected:move});
    if(!record.append(validate(record.position,move)))throw Error('append failed');prefix.push(move);
   }
   game.status='finished';save(path,game);console.log(JSON.stringify({mode,id,rows:game.rows.length}));
  }
 }else if(mode==='quality'){
  const roots=read(D+'/roots.json'),tasks=roots.map(root=>({root,nodes:12000}));
  for(const root of read(D+'/starts.json').slice(0,16))tasks.push({root,nodes:48000});
  mkdirSync(D+'/quality',{recursive:true});mkdirSync(D+'/quality-pending',{recursive:true});
  for(let i=shard;i<tasks.length;i+=shards){
   const file=String(i).padStart(3,'0')+'.json',path=D+'/quality/'+file;if(existsSync(path))continue;
   const {root,nodes}=tasks[i],pending=D+'/quality-pending/'+file;
   const row=existsSync(pending)?read(pending):{id:i,root,nodes,runs:[]};
   for(let j=row.runs.length;j<3;j++){row.runs.push(await run(root.prefix,Object.keys(models)[(i+j)%3],nodes));save(pending,row);}
   Object.assign(row,await score(root.prefix,row.runs.map(r=>r.chosenMove)));row.status='finished';save(path,row);
   console.log(JSON.stringify({mode,i,nodes,game:root.game,moves:row.runs.map(r=>r.chosenMove)}));
  }
 }else if(mode==='matches'){
  const starts=read(D+'/starts.json'),plans=[];
  for(const level of ['short','long']){
   const config=protocol.matches[level];
   for(const pair of config.pairs)for(const [i,root]of starts.slice(0,config.starts).entries())for(const side of ['black','white'])plans.push({id:`${level}-${pair.join('-')}-${i}-${side}`,level,pair,root,candidateSide:side,nodes:config.nodes});
  }
  mkdirSync(D+'/matches',{recursive:true});
  const other=c=>c==='black'?'white':'black';
  for(let i=shard;i<plans.length;i+=shards){
   const p=plans[i],path=D+'/matches/'+p.id+'.json';if(existsSync(path))continue;
   const game={...p,status:'running',moves:[],result:null},prefix=[...p.root.prefix],record=recordAt(START,prefix),initial=record.position.sfen;
   for(let ply=0;ply<=200;ply++){
    const state=await lab(prefix,['--legal']),side=record.position.color;
    if(state.repetition_score!==null){if(!record.repetition)throw Error('Repetition mismatch');const checker=record.perpetualCheck,winner=checker===null?null:other(checker);if((state.repetition_score===0?null:state.repetition_score>0?side:other(side))!==winner)throw Error('Perpetual mismatch');game.result={reason:checker===null?'repetition':'perpetual-check',winner};break;}
    if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(side)};break;}
    if(ply===200)break;
    const name=side===p.candidateSide?p.pair[0]:p.pair[1],analysis=await run(prefix,name,p.nodes),move=analysis.chosenMove;
    if(!state.moves.includes(move))throw Error('Lab illegal move');
    if(!record.append(validate(record.position,move)))throw Error('append failed');
    game.moves.push({ply:prefix.length+1,side,variant:name,usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,fallback:analysis.fallback,analysis});prefix.push(move);
   }
   if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};game.status='finished';
   const kif=exportGame({initial,moves:game.moves.map(m=>m.usi),result:JSON.stringify(game.result)});
   if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(game.moves.map(m=>m.usi)))throw Error('KIF mismatch');
   writeFileSync(D+'/matches/'+p.id+'.kif',kif);save(path,game);console.log(JSON.stringify({mode,i,id:p.id,plies:game.moves.length,result:game.result}));
  }
 }else if(mode==='fallback'){
  const cases=read(D+'/fallback-cases.json');mkdirSync(D+'/fallback',{recursive:true});
  for(let i=shard;i<cases.length;i+=shards){const path=D+'/fallback/'+String(i).padStart(3,'0')+'.json';if(existsSync(path))continue;const c=cases[i],r=await run(c.prefix,c.variant,12000);if(r.has_result)throw Error('Historical failure no longer reproduced');const legal=await lab(c.prefix,['--legal']);const row={...c,run:r,legacyMove:legal.moves[0],...await score(c.prefix,[legal.moves[0],r.chosenMove])};save(path,row);console.log(JSON.stringify({mode,i,legacy:row.legacyMove,new:r.chosenMove,source:r.fallback_source}));}
 }else throw Error('Unknown mode');
}finally{teacher?.close();}
