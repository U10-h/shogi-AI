// Frozen pair-model test, fresh balanced roots, and opt-in leaf observations.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const D=ROOT+'/results/v0.12',mode=process.argv[2],shard=Number(process.argv[3]||0),shards=Number(process.argv[4]||1);
const read=p=>JSON.parse(readFileSync(p));
const save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
const selected=read(D+'/selected.json').selected.name;
if(selected==='base')throw Error('No learned candidate passed validation; record the null result before defining further experiments');
const models={base:ASSETS+'/yaneuraou.data',pair:ROOT+'/build/models/v0.12/'+selected+'.nnue',affine:ROOT+'/build/models/v0.12/affine-gap.nnue',anchored50:ROOT+'/build/models/v0.10/anchored50.nnue',tempo40:ROOT+'/build/models/v0.10/tempo40.nnue'};
const signatures=Object.fromEntries(Object.entries(models).map(([n,p])=>[n,hash(p)]));
const protocolPath=D+'/protocol.json';
const openings=['7g7f 3c3d','2g2f 8c8d','7g7f 8c8d','2g2f 3c3d','5g5f 3c3d 2h5h 8c8d','7g7f 3c3d 2h6h 8c8d','7g7f 8c8d 6g6f 3c3d','2g2f 8c8d 2f2e 8d8e','7g7f 3c3d 8h2b+ 3a2b','2g2f 3c3d 7g7f 8c8d','7g7f 3c3d 6g6f 8c8d 2h7h','5g5f 8c8d 2h5h 3c3d','9g9f 3c3d 7g7f 8c8d','7g7f 3c3d 2h4h 8c8d','7g7f 3c3d 9g9f 9c9d 6g6f 4c4d','2g2f 4c4d 7g7f 3c3d'].map(x=>x.split(' '));
if(mode==='prepare'){
 if(existsSync(protocolPath))throw Error('Protocol already exists');
 save(protocolPath,{version:'v0.12',createdAt:new Date().toISOString(),seed:2026100112,selected,modelHashes:signatures,binarySha256:hash(BIN),
  data:{games:24,maxPlies:64,depth:6,multipv:3,novelty:'fresh trajectories in existing opening families; exclude all v0.10 labels and all v0.11 collected roots, including mirrors',rootRule:'one noncheck cp-only root per trajectory, abs(best teacher cp)<=250, ply>=16, closest to offset24; skip if none'},
  quality:{nodes:[12000,48000],teacherDepth:10,commonCandidateUnion:'all variants AND both node budgets for each root'},
  matches:{nodes:[12000,48000],starts:8,pairs:[['pair','base'],['pair','affine']],maxPlies:200,adjudication:'terminal and repetition only; move cap unresolved'},
  traces:{roots:8,nodes:12000,variants:['base','pair','affine','tempo40'],limit:100000},statistics:'paired trajectory bootstrap 5000 replicates; no Elo; no test-outcome tuning'});
 console.log('Protocol frozen');process.exit(0);
}
const protocol=read(protocolPath);
if(mode==='amend'){
 if(existsSync(D+'/quality')||existsSync(D+'/matches')||existsSync(D+'/protocol-v1.json'))throw Error('Amendment must precede test outcomes and occur only once');
 save(D+'/protocol-v1.json',protocol);
 protocol.amendment={at:new Date().toISOString(),reason:read(D+'/rank-protocol.json').reason,rankSelected:read(D+'/rank-training.json').selected,priorProtocolSha256:hash(D+'/protocol-v1.json')};
 protocol.modelHashes=signatures;protocol.selected=selected;protocol.traces.variants=['base','pair','affine','tempo40'];
 protocol.amendment.rankDecision='No checkpoint beat the original validation rank agreement; selected epoch 0 = base. Reject rank trial; later projected checkpoints also became numerically unstable.';
 protocol.matches.pairs=[['pair','base'],['pair','affine']];
 save(protocolPath,protocol);console.log('Validation-only amendment frozen; no test model outcomes opened');process.exit(0);
}
if(JSON.stringify(signatures)!==JSON.stringify(protocol.modelHashes)||hash(BIN)!==protocol.binarySha256)throw Error('Frozen model/binary mismatch');
function validate(p,m,pv=[]){const move=p.createMoveByUSI(m);if(!move||!p.isValidMove(move)||checkedPV(p,pv).length!==pv.length)throw Error('Illegal move/PV '+m);return move;}
async function run(root,name,nodes,extra=[]){
 const r=await lab(root.prefix,['--advanced','--preset','tactical','--eval','nnue','--eval-model',models[name],'--depth','16','--iterative','--max-nodes',String(nodes),...extra]);
 const chosenMove=r.has_result?r.bestmove:r.fallback_move;
 validate(recordAt(START,root.prefix).position,chosenMove,r.has_result?r.pv:r.fallback_pv);
 if(r.nodes>nodes)throw Error('Node overflow');
 return {variant:name,budget:nodes,chosenMove,fallback:!r.has_result,...r};
}
const teacher=['collect','quality'].includes(mode)?await yaneura(undefined,{allLegalMoves:true}):null;
try{
 if(mode==='collect'){
  mkdirSync(D+'/games',{recursive:true});
  for(let id=shard;id<24;id+=shards){
   const path=D+'/games/'+String(id).padStart(2,'0')+'.json';if(existsSync(path))continue;
   let seed=(protocol.seed+id*7919)>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
   const prefix=[...openings[id%openings.length]],record=recordAt(START,prefix),game={id,opening:[...prefix],seed,status:'running',rows:[],terminal:null};
   await teacher.reset();
   for(let offset=0;offset<64;offset++){
    if(record.repetition||!hasLegalMove(record.position)){game.terminal={sfen:record.position.sfen,repetition:record.repetition};break;}
    const a=await teacher.search(prefix,{depth:6,multipv:3}),ranks=new Map();for(const i of a.infos)if(!i.bound)ranks.set(i.rank,i);
    const cs=[...ranks.values()].sort((a,b)=>a.rank-b.rank);for(const c of cs)validate(record.position,c.pv[0],c.pv);
    const eligible=cs.filter(c=>c.type==='cp'&&c.score>=cs[0].score-(offset<16?180:80));
    const move=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
    game.rows.push({game:id,offset,ply:prefix.length,prefix:[...prefix],sfen:record.position.sfen,checked:record.position.checked,candidates:cs,selected:move});
    if(!record.append(validate(record.position,move)))throw Error('append failed');prefix.push(move);
   }
   game.status='finished';save(path,game);console.log(JSON.stringify({mode,id,rows:game.rows.length}));
  }
 }else if(mode==='quality'){
  mkdirSync(D+'/quality',{recursive:true});mkdirSync(D+'/quality-pending',{recursive:true});
  const roots=read(D+'/roots.json');
  for(let id=shard;id<roots.length;id+=shards){
   const path=D+'/quality/'+String(id).padStart(3,'0')+'.json',pending=D+'/quality-pending/'+String(id).padStart(3,'0')+'.json';if(existsSync(path))continue;
   const root=roots[id],row=existsSync(pending)?read(pending):{id,root,runs:[]};
   const names=Object.keys(models),tasks=[];for(const nodes of protocol.quality.nodes)for(let j=0;j<names.length;j++)tasks.push({nodes,name:names[(id+j)%names.length]});
   for(let j=row.runs.length;j<tasks.length;j++){const t=tasks[j];row.runs.push(await run(root,t.name,t.nodes));save(pending,row);}
   await teacher.reset();const unrestricted=await teacher.search(root.prefix,{depth:10});
   const moves=[...new Set([...row.runs.map(r=>r.chosenMove),unrestricted.move])];
   await teacher.reset();const scored=await teacher.search(root.prefix,{depth:10,multipv:moves.length,searchmoves:moves});
   const ranked=new Map();for(const i of scored.infos)if(!i.bound&&moves.includes(i.pv[0]))ranked.set(i.pv[0],i);
   if(ranked.size!==moves.length)throw Error('Incomplete teacher candidates');
   const candidates=moves.map(m=>({move:m,...ranked.get(m)}));
   for(const c of candidates){if(c.depth<10&&c.type!=='mate')throw Error('Incomplete depth');validate(recordAt(START,root.prefix).position,c.move,c.pv);}
   Object.assign(row,{unrestricted,scored,candidates,status:'finished'});save(path,row);
   console.log(JSON.stringify({mode,id,game:root.game,moves:moves.length}));
  }
 }else if(mode==='matches'){
  mkdirSync(D+'/matches',{recursive:true});const starts=read(D+'/roots.json').slice(0,8),plans=[];
  for(const nodes of protocol.matches.nodes)for(const pair of protocol.matches.pairs)for(const root of starts)for(const side of ['black','white'])plans.push({id:`${nodes}-${pair.join('-')}-${root.game}-${side}`,pair,root,candidateSide:side,nodes});
  const other=c=>c==='black'?'white':'black';
  for(let i=shard;i<plans.length;i+=shards){
   const p=plans[i],path=D+'/matches/'+p.id+'.json';if(existsSync(path))continue;
   const game={...p,status:'running',moves:[],result:null},prefix=[...p.root.prefix],record=recordAt(START,prefix),initial=record.position.sfen;
   for(let ply=0;ply<=200;ply++){
    const state=await lab(prefix,['--legal']),side=record.position.color;
    if(state.repetition_score!==null){if(!record.repetition)throw Error('Repetition mismatch');const checker=record.perpetualCheck,winner=checker===null?null:other(checker);if((state.repetition_score===0?null:state.repetition_score>0?side:other(side))!==winner)throw Error('Perpetual mismatch');game.result={reason:checker===null?'repetition':'perpetual-check',winner};break;}
    if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(side)};break;}
    if(ply===200)break;
    const name=side===p.candidateSide?p.pair[0]:p.pair[1],analysis=await run({prefix},name,p.nodes),move=analysis.chosenMove;
    if(!state.moves.includes(move)||!record.append(validate(record.position,move)))throw Error('Illegal move');
    game.moves.push({ply:prefix.length+1,side,variant:name,usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,fallback:analysis.fallback,analysis});prefix.push(move);
   }
   if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};game.status='finished';
   const kif=exportGame({initial,moves:game.moves.map(m=>m.usi),result:JSON.stringify(game.result)});
   if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(game.moves.map(m=>m.usi)))throw Error('KIF mismatch');
   writeFileSync(D+'/matches/'+p.id+'.kif',kif);save(path,game);console.log(JSON.stringify({mode,i,id:p.id,plies:game.moves.length,result:game.result}));
  }
 }else if(mode==='trace'){
  mkdirSync(D+'/traces',{recursive:true});const roots=read(D+'/roots.json').slice(0,8);
  for(let i=shard;i<roots.length;i+=shards)for(const name of protocol.traces.variants){
   const stem=D+'/traces/'+String(i).padStart(2,'0')+'-'+name;
   if(existsSync(stem+'.json'))continue;
   const traced=await run(roots[i],name,12000,['--leaf-trace',stem+'.jsonl','--trace-limit','100000']);
   const normal=read(D+'/quality/'+String(i).padStart(3,'0')+'.json').runs.find(r=>r.variant===name&&r.budget===12000);
   const fields=['score','pv','nodes','completed_depth','has_result','stop_reason','bestmove','stats','fallback_move','fallback_pv'];
   for(const key of fields)if(JSON.stringify(traced[key])!==JSON.stringify(normal[key]))throw Error('Trace changes search: '+key);
   save(stem+'.json',{root:roots[i],variant:name,identicalFields:fields,analysis:traced});console.log(JSON.stringify({mode,i,name}));
  }
 }else throw Error('Unknown mode');
}finally{teacher?.close();}
