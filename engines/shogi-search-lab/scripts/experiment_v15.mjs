// All timed searches run serially. Use no simultaneous build/training jobs.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove} from './record_helpers.mjs';
const D=process.env.V15_RESULTS||ROOT+'/results/v0.15',mode=process.argv[2];
mkdirSync(D,{recursive:true});
const read=p=>JSON.parse(readFileSync(p));
const save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
const features='tt,history,killer,counter,mate-distance,qsearch,capture-history';
const signatures=()=>({baseline:hash(ROOT+'/build/shogi-lab-v0.14'),candidate:hash(BIN),evaluation:hash(ASSETS+'/yaneuraou.data')});
function args(name){
 let flags=features,extra=[];
 if(name==='lmr')flags+=',lmr';
 if(name==='history')flags+=',history-lmr';
 if(name==='aspiration')extra=['--driver','aspiration'];
 if(name==='eager')extra=['--eager-order'];
 if(name==='scalar')extra=['--eval','nnue-scalar'];
 return ['--advanced','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data','--features',flags,...extra];
}
function validate(root,r){
 const p=recordAt(START,root.prefix).position,pv=r.has_result?r.pv:r.fallback_pv;
 if(!pv.length||checkedPV(p,pv).length!==pv.length)throw Error('Illegal/incomplete PV');
 return r.has_result?r.bestmove:r.fallback_move;
}
async function run(root,name,limits){
 const r=await lab(root.prefix,[...args(name),...limits.map(String)],START,name==='baseline'?ROOT+'/build/shogi-lab-v0.14':BIN);
 return {...r,variant:name,chosenMove:validate(root,r)};
}
if(mode==='freeze'){
 if(existsSync(D+'/protocol.json'))throw Error('Already frozen');
 save(D+'/protocol.json',{seed:2026092215,signatures:signatures(),names:['baseline','fast','lmr','history'],roots:16,
  generation:'Advance first 16 v0.14 roots 12 plies; historical teacher depth6 MultiPV3, random within120cp; final roots compared against all v0.13/v0.14 trajectories.',
  fixed:{depth:4,repeats:3,nodes:10000000},quality:{ms:[1000,3000],repeats:2,teacherDepth:12},
  limitations:'Same opening families as earlier work; independent continuations, no new training. No Elo claim. Timing excludes model load/process startup.'});
 console.log('Frozen');process.exit(0);
}
const protocol=read(D+'/protocol.json');
if(JSON.stringify(signatures())!==JSON.stringify(protocol.signatures))throw Error('Frozen binary/model mismatch');
if(mode==='collect'){
 const teacher=await yaneura(undefined,{allLegalMoves:true});
 try{
  const starts=read(ROOT+'/results/v0.14/roots.json').slice(0,protocol.roots),roots=[],rows=[];
  const norm=s=>s.split(' ').slice(0,3).join(' '),seen=new Set();
  for(const version of ['v0.13','v0.14'])for(let id=0;id<24;id++){
   const p=ROOT+'/results/'+version+'/games/'+String(id).padStart(2,'0')+'.json';
   if(existsSync(p))for(const r of read(p).rows)seen.add(norm(r.sfen));
  }
  for(let id=0;id<starts.length;id++){
   let seed=(protocol.seed+id*7919)>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
   const prefix=[...starts[id].prefix],record=recordAt(START,prefix);await teacher.reset();
   let terminal=false;
   for(let ply=0;ply<12;ply++){
    if(record.repetition||!hasLegalMove(record.position)){terminal=true;break;}
    const a=await teacher.search(prefix,{depth:6,multipv:3}),ranks=new Map();
    for(const i of a.infos)if(!i.bound)ranks.set(i.rank,i);
    const cs=[...ranks.values()].sort((a,b)=>a.rank-b.rank);
    const eligible=cs.filter(c=>c.type==='cp'&&cs[0].type==='cp'&&c.score>=cs[0].score-120);
    const move=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
    rows.push({id,ply,prefix:[...prefix],sfen:record.position.sfen,analysis:a,selected:move});
    const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Bad teacher move');
    prefix.push(move);
   }
   const sfen=record.position.sfen;
   if(terminal||record.repetition||!hasLegalMove(record.position))throw Error('Predefined continuation became terminal; retain failure, do not substitute');
   if(seen.has(norm(sfen)))throw Error('Known test root; retain failure, do not resample');
   seen.add(norm(sfen));roots.push({id,sourceGame:starts[id].game,prefix,sfen});
   console.log(JSON.stringify({mode,id,plies:prefix.length}));
  }
  save(D+'/roots.json',roots);save(D+'/generation.json',{roots:roots.length,oldPositionsCompared:seen.size-roots.length,rows});
 }finally{teacher.close();}
}else if(mode==='fixed'||mode==='dev'){
 const roots=mode==='dev'?read(ROOT+'/results/v0.14/roots.json').slice(0,8):read(D+'/roots.json');
 const names=mode==='dev'?['baseline','fast','eager','scalar','lmr','history','aspiration']:protocol.names;
 mkdirSync(D+'/'+mode,{recursive:true});
 for(let rep=0;rep<(mode==='dev'?1:protocol.fixed.repeats);rep++)for(let id=0;id<roots.length;id++)for(let j=0;j<names.length;j++){
  const name=names[(id+rep+j)%names.length],path=D+'/'+mode+'/'+id+'-'+name+'-'+rep+'.json';if(existsSync(path))continue;
  const limits=mode==='dev'?['--depth',16,'--iterative','--max-nodes',200000]:['--depth',protocol.fixed.depth,'--max-nodes',protocol.fixed.nodes];
  const r=await run(roots[id],name,limits);save(path,{id,rep,root:roots[id],analysis:r});
  console.log(JSON.stringify({mode,id,rep,name,ms:r.elapsed_ms,nodes:r.nodes,depth:r.completed_depth}));
 }
}else if(mode==='quality'){
 const roots=read(D+'/roots.json');mkdirSync(D+'/quality',{recursive:true});
 // Finish every timed run before starting teacher work, to avoid cross-load.
 for(let rep=0;rep<protocol.quality.repeats;rep++)for(let id=0;id<roots.length;id++)for(const ms of protocol.quality.ms){
  const path=D+'/quality/'+id+'-'+ms+'-'+rep+'.json';if(existsSync(path))continue;
  const runs=[];
  for(let j=0;j<protocol.names.length;j++){
   const name=protocol.names[(id+rep+j)%protocol.names.length];
   runs.push(await run(roots[id],name,['--depth',16,'--iterative','--max-nodes',1000000000,'--time-ms',ms]));
  }
  save(path,{id,rep,ms,root:roots[id],runs});console.log(JSON.stringify({mode,id,rep,ms,depths:runs.map(r=>[r.variant,r.completed_depth])}));
 }
}else if(mode==='score'){
 const roots=read(D+'/roots.json'),teacher=await yaneura(undefined,{allLegalMoves:true});mkdirSync(D+'/teacher',{recursive:true});
 try{for(let id=0;id<roots.length;id++){
  const path=D+'/teacher/'+id+'.json';if(existsSync(path))continue;
  const chosen=[];for(let rep=0;rep<protocol.quality.repeats;rep++)for(const ms of protocol.quality.ms)
   chosen.push(...read(D+'/quality/'+id+'-'+ms+'-'+rep+'.json').runs.map(r=>r.chosenMove));
  await teacher.reset();const unrestricted=await teacher.search(roots[id].prefix,{depth:protocol.quality.teacherDepth});
  const moves=[...new Set([...chosen,unrestricted.move])];await teacher.reset();
  const scored=await teacher.search(roots[id].prefix,{depth:protocol.quality.teacherDepth,multipv:moves.length,searchmoves:moves});
  const ranks=new Map();for(const x of scored.infos)if(!x.bound&&moves.includes(x.pv[0]))ranks.set(x.pv[0],x);
  if(ranks.size!==moves.length)throw Error('Incomplete teacher ranks');
  const candidates=moves.map(m=>({move:m,...ranks.get(m)}));
  for(const c of candidates)if(c.depth<protocol.quality.teacherDepth||checkedPV(recordAt(START,roots[id].prefix).position,c.pv).length!==c.pv.length)throw Error('Incomplete/illegal teacher PV');
  save(path,{id,root:roots[id],unrestricted,scored,candidates});console.log(JSON.stringify({mode,id,candidates:candidates.map(c=>[c.move,c.type,c.score])}));
 }}finally{teacher.close();}
}else throw Error('Use freeze|collect|dev|fixed|quality|score');
