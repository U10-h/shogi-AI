// Independent trajectories and frozen learned-pruning comparisons.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const D=ROOT+'/results/v0.13',M=ROOT+'/models/v0.13',mode=process.argv[2],shard=Number(process.argv[3]||0),shards=Number(process.argv[4]||1);
const read=p=>JSON.parse(readFileSync(p));
const save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
const names=['base','delta','direct','guarded','verified','efficient','efficient005','efficient0025'];
const signatures={evaluation:hash(ASSETS+'/yaneuraou.data'),risk:hash(M+'/alpha-risk.txt'),cost:hash(M+'/alpha-risk-cost.txt'),binary:hash(BIN)};
function policy(name){
 if(name==='base')return [];
 if(name==='delta')return ['--features','tt,history,killer,counter,mate-distance,qsearch,delta'];
 const efficient=name.startsWith('efficient'),args=['--prune-policy',efficient?'efficient':name,'--prune-model',M+(efficient?'/alpha-risk-cost.txt':'/alpha-risk.txt')];
 if(name==='direct')args.push('--prune-probability','0.05');
 if(name==='efficient005')args.push('--prune-probability','0.005');
 if(name==='efficient0025')args.push('--prune-probability','0.0025');
 return args;
}
const openings=['7g7f 3c3d','2g2f 8c8d','7g7f 8c8d','2g2f 3c3d','5g5f 3c3d 2h5h 8c8d','7g7f 3c3d 2h6h 8c8d','7g7f 8c8d 6g6f 3c3d','2g2f 8c8d 2f2e 8d8e','7g7f 3c3d 8h2b+ 3a2b','2g2f 3c3d 7g7f 8c8d','7g7f 3c3d 6g6f 8c8d 2h7h','5g5f 8c8d 2h5h 3c3d','9g9f 3c3d 7g7f 8c8d','7g7f 3c3d 2h4h 8c8d','7g7f 3c3d 9g9f 9c9d 6g6f 4c4d','2g2f 4c4d 7g7f 3c3d'].map(x=>x.split(' '));
if(mode==='prepare'){
 if(existsSync(D+'/protocol.json'))throw Error('Already frozen');
 const development=read(D+'/development-selection.json');
 save(D+'/protocol.json',{version:'v0.13',createdAt:new Date().toISOString(),seed:2026101313,signatures,
  data:{games:24,maxPlies:64,depth:6,multipv:3,rootRule:'one noncheck root per trajectory, cp-only, abs(top)<=250, ply>=16, nearest offset24; exclude old positions/mirrors and training q nodes'},
  quality:{names,nodes:[12000,48000],teacherDepth:10,union:'all variants AND both node budgets per root; restricted MultiPV'},
  fixedDepth:{depth:3,maxNodes:2000000,repeats:3,timing:'sequential, rotated order, no other jobs; internal elapsed excludes model/process startup'},
  audits:{roots:16,depth:3,names:names.filter(x=>!['base','delta'].includes(x))},
  matches:{candidate:development.selected,starts:8,nodes:12000,pairs:[[development.selected,'base'],[development.selected,'delta']],maxPlies:200,adjudication:'terminal or repetition only; move cap unresolved'},
  statistics:'paired trajectory bootstrap 5000 replicates; no test tuning, no Elo; same opening families are not unseen-family generalization'});
 console.log('Frozen',development.selected,signatures);process.exit(0);
}
const protocol=read(D+'/protocol.json');if(JSON.stringify(signatures)!==JSON.stringify(protocol.signatures))throw Error('Frozen signature mismatch');
function validate(p,m,pv=[]){const move=p.createMoveByUSI(m);if(!move||!p.isValidMove(move)||checkedPV(p,pv).length!==pv.length)throw Error('Illegal move/PV '+m);return move;}
async function run(root,name,args){
 const r=await lab(root.prefix,['--advanced','--preset','tactical','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data',...policy(name),...args.map(String)]);
 const chosenMove=r.has_result?r.bestmove:r.fallback_move;
 validate(recordAt(START,root.prefix).position,chosenMove,r.has_result?r.pv:r.fallback_pv);
 return {variant:name,chosenMove,fallback:!r.has_result,...r};
}
const teacher=['collect','quality'].includes(mode)?await yaneura(undefined,{allLegalMoves:true}):null;
try{
 if(mode==='collect'){
  mkdirSync(D+'/games',{recursive:true});
  for(let id=shard;id<24;id+=shards){
   const path=D+'/games/'+String(id).padStart(2,'0')+'.json';if(existsSync(path))continue;
   let seed=(protocol.seed+id*7919)>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
   const prefix=[...openings[id%openings.length]],record=recordAt(START,prefix),game={id,seed,opening:[...prefix],status:'running',rows:[]};await teacher.reset();
   for(let offset=0;offset<64;offset++){
    if(record.repetition||!hasLegalMove(record.position))break;
    const a=await teacher.search(prefix,{depth:6,multipv:3}),ranks=new Map();for(const i of a.infos)if(!i.bound)ranks.set(i.rank,i);
    const cs=[...ranks.values()].sort((a,b)=>a.rank-b.rank);for(const c of cs)validate(record.position,c.pv[0],c.pv);
    const eligible=cs.filter(c=>c.type==='cp'&&c.score>=cs[0].score-(offset<16?180:80));
    const move=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
    game.rows.push({game:id,offset,ply:prefix.length,prefix:[...prefix],sfen:record.position.sfen,checked:record.position.checked,candidates:cs,selected:move});
    if(!record.append(validate(record.position,move)))throw Error('append');prefix.push(move);
   }
   game.status='finished';save(path,game);console.log(JSON.stringify({mode,id,rows:game.rows.length}));
  }
 }else if(mode==='quality'){
  mkdirSync(D+'/quality',{recursive:true});mkdirSync(D+'/quality-pending',{recursive:true});const roots=read(D+'/roots.json');
  for(let id=shard;id<roots.length;id+=shards){
   const path=D+'/quality/'+String(id).padStart(3,'0')+'.json',pending=D+'/quality-pending/'+String(id).padStart(3,'0')+'.json';if(existsSync(path))continue;
   const root=roots[id],row=existsSync(pending)?read(pending):{id,root,runs:[]};const tasks=[];
   for(const nodes of protocol.quality.nodes)for(let j=0;j<names.length;j++)tasks.push({nodes,name:names[(id+j)%names.length]});
   for(let j=row.runs.length;j<tasks.length;j++){const t=tasks[j],r=await run(root,t.name,['--depth',16,'--iterative','--max-nodes',t.nodes]);if(r.nodes>t.nodes)throw Error('Node overflow');row.runs.push({budget:t.nodes,...r});save(pending,row);}
   await teacher.reset();const unrestricted=await teacher.search(root.prefix,{depth:10});
   const moves=[...new Set([...row.runs.map(r=>r.chosenMove),unrestricted.move])];
   await teacher.reset();const scored=await teacher.search(root.prefix,{depth:10,multipv:moves.length,searchmoves:moves});
   const ranked=new Map();for(const i of scored.infos)if(!i.bound&&moves.includes(i.pv[0]))ranked.set(i.pv[0],i);
   if(ranked.size!==moves.length)throw Error('Incomplete teacher candidates');const candidates=moves.map(m=>({move:m,...ranked.get(m)}));
   for(const c of candidates){if(c.depth<10&&c.type!=='mate')throw Error('Incomplete depth');validate(recordAt(START,root.prefix).position,c.move,c.pv);}
   Object.assign(row,{unrestricted,scored,candidates,status:'finished'});save(path,row);console.log(JSON.stringify({mode,id,moves:moves.length}));
  }
 }else if(mode==='fixed'||mode==='audit'){
  mkdirSync(D+'/'+mode,{recursive:true});const roots=read(D+'/roots.json').slice(0,mode==='audit'?protocol.audits.roots:undefined);
  for(let id=shard;id<roots.length;id+=shards)for(let rep=0;rep<(mode==='fixed'?3:1);rep++)for(let j=0;j<names.length;j++){
   const name=names[(id+rep+j)%names.length];if(mode==='audit'&&['base','delta'].includes(name))continue;
   const stem=D+'/'+mode+'/'+String(id).padStart(3,'0')+'-'+name+'-'+rep;if(existsSync(stem+'.json'))continue;
   const args=['--depth',3,'--max-nodes',2000000];if(mode==='audit')args.push('--prune-audit','--prune-log',stem+'.jsonl','--trace-limit',2000000);
   const r=await run(roots[id],name,args);save(stem+'.json',{id,rep,root:roots[id],analysis:r});console.log(JSON.stringify({mode,id,rep,name,nodes:r.nodes,complete:r.complete}));
  }
 }else if(mode==='matches'){
  mkdirSync(D+'/matches',{recursive:true});const starts=read(D+'/roots.json').slice(0,8),plans=[];
  for(const pair of protocol.matches.pairs)for(const root of starts)for(const side of ['black','white'])plans.push({id:`${pair.join('-')}-${root.game}-${side}`,pair,root,candidateSide:side,nodes:12000});
  const other=c=>c==='black'?'white':'black';
  for(let i=shard;i<plans.length;i+=shards){
   const p=plans[i],path=D+'/matches/'+p.id+'.json';if(existsSync(path))continue;
   const game={...p,status:'running',moves:[],result:null},prefix=[...p.root.prefix],record=recordAt(START,prefix),initial=record.position.sfen;
   for(let ply=0;ply<=200;ply++){
    const state=await lab(prefix,['--legal']),side=record.position.color;
    if(state.repetition_score!==null){if(!record.repetition)throw Error('Repetition mismatch');const checker=record.perpetualCheck,winner=checker===null?null:other(checker);if((state.repetition_score===0?null:state.repetition_score>0?side:other(side))!==winner)throw Error('Perpetual mismatch');game.result={reason:checker===null?'repetition':'perpetual-check',winner};break;}
    if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(side)};break;}
    if(ply===200)break;
    const name=side===p.candidateSide?p.pair[0]:p.pair[1],analysis=await run({prefix},name,['--depth',16,'--iterative','--max-nodes',12000]),move=analysis.chosenMove;
    if(!state.moves.includes(move)||!record.append(validate(record.position,move)))throw Error('Illegal move');
    game.moves.push({ply:prefix.length+1,side,variant:name,usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,analysis});prefix.push(move);
   }
   if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};game.status='finished';
   const kif=exportGame({initial,moves:game.moves.map(m=>m.usi),result:JSON.stringify(game.result)});
   if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(game.moves.map(m=>m.usi)))throw Error('KIF mismatch');
   writeFileSync(D+'/matches/'+p.id+'.kif',kif);save(path,game);console.log(JSON.stringify({mode,i,plies:game.moves.length,result:game.result}));
  }
 }else throw Error('Unknown mode');
}finally{teacher?.close();}
