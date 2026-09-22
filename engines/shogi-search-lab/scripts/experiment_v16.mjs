// Frozen experiment. Run all timed jobs serially; no simultaneous compilation.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const D=process.env.V16_RESULTS||ROOT+'/results/v0.16',mode=process.argv[2];mkdirSync(D,{recursive:true});
const read=p=>JSON.parse(readFileSync(p));const save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
const flags='tt,history,killer,counter,mate-distance,qsearch,capture-history';
export function args(name){
 const evals={baseline:'nnue',history:'nnue',adaptive:'nnue',blend:'nnue-blend25',clipped:'nnue-clipped',tempo:'nnue-tempo40'};
 if(!evals[name])throw Error('Unknown variant');
 const a=['--advanced','--eval',evals[name],'--eval-model',ASSETS+'/yaneuraou.data','--features',flags+(name==='history'?',history-lmr':'')];
 if(name==='blend'||name==='clipped')a.push('--eval-head',ROOT+'/models/v0.16/pair100-head.txt');
 if(!['baseline','history'].includes(name))a.push('--driver','adaptive');
 else a.push('--depth','16','--iterative');
 return a;
}
const signatures=()=>({binary:hash(BIN),base:hash(ASSETS+'/yaneuraou.data'),head:hash(ROOT+'/models/v0.16/pair100-head.txt'),opponent:hash(ASSETS+'/yaneuraou.wasm')});
if(mode==='freeze'){
 if(existsSync(D+'/protocol.json'))throw Error('Already frozen');
 save(D+'/protocol.json',{schema:1,seed:2026092216,signatures:signatures(),names:['baseline','history','adaptive','blend','clipped','tempo'],roots:16,
 generation:'Advance v0.15 roots 8 plies, teacher depth6 MultiPV3, random within120cp; no fitting to new roots. Same opening families.',
 quality:{ms:[300,1000],repeats:2,teacherDepth:12},
 matches:{variants:['baseline','adaptive','blend','clipped'],ms:1000,openings:[[],['7g7f','3c3d','2g2f','5c5d','2f2e','8b5b']],colors:['black','white'],maxPlies:200},
 choice:'No deployment promotion from these few games. Record all candidates. Teacher gap and actual games separated.',
 runtime:'Native single-thread candidate vs historical WASM YaneuraOu 6.03, NNUE KP256 2019. Reset teacher each move; candidate fresh worker each move. Startup/model loading outside per-move search budget.',
 safety:'95-ply emergency ceiling, node cap 1e9, 200-ply game cap recorded unresolved. Adaptive depth field is effort iteration, not plies; use selective_depth/PV length.',
 prior:'v0.12 pair100 frozen; 25% residual, ±72raw cap, tempo+36raw fixed before new measurements.'});
 console.log('Frozen');process.exit(0);
}
const P=read(D+'/protocol.json');if(JSON.stringify(signatures())!==JSON.stringify(P.signatures))throw Error('Frozen code/model mismatch');
async function run(prefix,name,ms){
 const r=await lab(prefix,[...args(name),'--max-nodes','1000000000','--time-ms',String(ms)]),pv=r.has_result?r.pv:r.fallback_pv;
 if(!pv.length||checkedPV(recordAt(START,prefix).position,pv).length!==pv.length)throw Error('Illegal/incomplete lab PV');
 return {...r,variant:name,chosenMove:pv[0]};
}
if(mode==='collect'){
 const teacher=await yaneura(undefined,{allLegalMoves:true}),roots=[],rows=[],norm=s=>s.split(' ').slice(0,3).join(' ');
 const known=new Set(['v0.13','v0.14','v0.15'].flatMap(v=>read(ROOT+'/results/'+v+'/roots.json').map(r=>norm(r.sfen))));
 try{for(const [id,start]of read(ROOT+'/results/v0.15/roots.json').slice(0,P.roots).entries()){
  const prefix=[...start.prefix];let seed=(P.seed+id*7919)>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const record=recordAt(START,prefix);await teacher.reset();
  for(let i=0;i<8;i++){
   if(record.repetition||!hasLegalMove(record.position))throw Error('Terminal predefined continuation');
   const a=await teacher.search(prefix,{depth:6,multipv:3});const ranks=new Map();for(const x of a.infos)if(!x.bound)ranks.set(x.rank,x);
   const cs=[...ranks.values()].sort((a,b)=>a.rank-b.rank),eligible=cs.filter(c=>c.type==='cp'&&cs[0].type==='cp'&&c.score>=cs[0].score-120);
   const move=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
   rows.push({id,i,prefix:[...prefix],sfen:record.position.sfen,analysis:a,move});
   const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Illegal teacher move');prefix.push(move);
  }
  const sfen=record.position.sfen;if(record.repetition||!hasLegalMove(record.position)||known.has(norm(sfen)))throw Error('Terminal/duplicate new root; no resampling');
  known.add(norm(sfen));roots.push({id,prefix,sfen});console.log(JSON.stringify({mode,id,plies:prefix.length}));
 }}finally{teacher.close();}
 save(D+'/roots.json',roots);save(D+'/generation.json',rows);
}else if(mode==='quality'){
 const roots=read(D+'/roots.json');mkdirSync(D+'/quality',{recursive:true});
 for(let rep=0;rep<P.quality.repeats;rep++)for(const root of roots)for(const ms of P.quality.ms){
  const p=D+'/quality/'+root.id+'-'+ms+'-'+rep+'.json';if(existsSync(p))continue;
  const runs=[];for(let j=0;j<P.names.length;j++){const name=P.names[(root.id+rep+j)%P.names.length];runs.push(await run(root.prefix,name,ms));}
  save(p,{id:root.id,rep,ms,root,runs});console.log(JSON.stringify({mode,id:root.id,rep,ms,runs:runs.map(r=>[r.variant,r.chosenMove,r.completed_depth,r.stats.selective_depth])}));
 }
}else if(mode==='score'){
 const teacher=await yaneura(undefined,{allLegalMoves:true});mkdirSync(D+'/teacher',{recursive:true});
 try{for(const root of read(D+'/roots.json')){
  const p=D+'/teacher/'+root.id+'.json';if(existsSync(p))continue;
  const chosen=[];for(let rep=0;rep<P.quality.repeats;rep++)for(const ms of P.quality.ms)chosen.push(...read(D+'/quality/'+root.id+'-'+ms+'-'+rep+'.json').runs.map(r=>r.chosenMove));
  await teacher.reset();const unrestricted=await teacher.search(root.prefix,{depth:P.quality.teacherDepth});
  const moves=[...new Set([...chosen,unrestricted.move])];await teacher.reset();
  const scored=await teacher.search(root.prefix,{depth:P.quality.teacherDepth,multipv:moves.length,searchmoves:moves});
  const found=new Map();for(const x of scored.infos)if(!x.bound&&moves.includes(x.pv[0]))found.set(x.pv[0],x);
  if(found.size!==moves.length)throw Error('Incomplete teacher ranks');
  const candidates=moves.map(move=>({move,...found.get(move)}));
  for(const c of candidates)if(c.depth<P.quality.teacherDepth||checkedPV(recordAt(START,root.prefix).position,c.pv).length!==c.pv.length)throw Error('Incomplete/illegal teacher PV');
  save(p,{id:root.id,unrestricted,scored,candidates});console.log(JSON.stringify({mode,id:root.id,candidates:candidates.map(c=>[c.move,c.type,c.score])}));
 }}finally{teacher.close();}
}else if(mode==='matches'){
 const teacher=await yaneura(D+'/opponent.jsonl');mkdirSync(D+'/matches',{recursive:true});
 save(D+'/opponent-settings.json',{name:teacher.name,options:teacher.options,handshake:teacher.handshake});
 const other=c=>c==='black'?'white':'black';
 try{for(const [oid,opening]of P.matches.openings.entries())for(const side of P.matches.colors)for(let j=0;j<P.matches.variants.length;j++){
  const name=P.matches.variants[(oid+j+(side==='white'?1:0))%P.matches.variants.length],id=oid+'-'+side+'-'+name,path=D+'/matches/'+id+'.json';
  if(existsSync(path)&&read(path).status==='finished')continue;
  const record=recordAt(START,opening),game={id,name,candidateSide:side,opening,initial:START,ms:P.matches.ms,status:'running',moves:[],result:null};save(path,game);
  for(let ply=0;ply<=P.matches.maxPlies;ply++){
   const prefix=[...opening,...game.moves.map(m=>m.usi)],state=await lab(prefix,['--legal']),color=record.position.color;
   if(state.repetition_score!==null){game.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?color:other(color)};break;}
   if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Independent terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(color)};break;}
   if(ply===P.matches.maxPlies)break;
   const candidate=color===side;let analysis,move,wallMs;const begin=performance.now();
   if(candidate){analysis=await run(prefix,name,P.matches.ms);move=analysis.chosenMove;wallMs=performance.now()-begin;}
   else{await teacher.reset();const a=await teacher.search(prefix,{ms:P.matches.ms});analysis=a;move=a.move;wallMs=a.wallMs;
    if(move==='resign'){game.result={reason:'resign',winner:other(color)};break;}}
   if(!state.moves.includes(move))throw Error('Illegal match move '+move);
   const pv=candidate?(analysis.has_result?analysis.pv:analysis.fallback_pv):analysis.info?.pv;
   if(pv&&checkedPV(record.position,pv).length!==pv.length)throw Error('Illegal match PV');
   const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Independent move mismatch');
   game.moves.push({ply:prefix.length+1,side:color,variant:candidate?name:'yaneuraou',usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,analysis,wallMs});save(path,game);
   if(ply%20===0)console.log(JSON.stringify({mode,id,ply:prefix.length+1,move}));
  }
  if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};game.status='finished';save(path,game);
  const all=[...opening,...game.moves.map(m=>m.usi)],kif=exportGame({initial:START,moves:all,result:JSON.stringify(game.result)});
  if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(all))throw Error('KIF roundtrip mismatch');writeFileSync(D+'/matches/'+id+'.kif',kif);
  console.log(JSON.stringify({mode,id,plies:game.moves.length,result:game.result}));
 }}finally{teacher.close();}
}else throw Error('freeze|collect|quality|score|matches');
