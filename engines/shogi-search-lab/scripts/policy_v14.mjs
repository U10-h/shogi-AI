import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,readdirSync,unlinkSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const D=process.env.V14_RESULTS||ROOT+'/results/v0.14',M=ROOT+'/models/v0.14',mode=process.argv[2];
const read=p=>JSON.parse(readFileSync(p));
const save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
function policy(name){
 const args=[];
 if(name.includes('policy')){const scale=Number(name.match(/policy(\d+)/)?.[1]||1);args.push('--policy-model',M+'/quiet-policy.txt','--policy-scale',String(scale));}
 if(name.includes('lmr')||name.includes('capture'))args.push('--features','tt,history,killer,counter,mate-distance,qsearch'+(name.includes('lmr')?',lmr':'')+(name.includes('capture')?',capture-history':''));
 return args;
}
function validate(p,m,pv=[]){const move=p.createMoveByUSI(m);if(!move||!p.isValidMove(move)||checkedPV(p,pv).length!==pv.length)throw Error('Illegal move/PV '+m);return move;}
async function run(root,name,args){
 const r=await lab(root.prefix||[],['--advanced','--preset','tactical','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data',...policy(name),...args.map(String)],root.prefix?START:root.sfen);
 const chosenMove=r.has_result?r.bestmove:r.fallback_move;
 validate(recordAt(root.prefix?START:root.sfen,root.prefix||[]).position,chosenMove,r.has_result?r.pv:r.fallback_pv);
 return {variant:name,chosenMove,fallback:!r.has_result,...r};
}
const signatures=()=>({evaluation:hash(ASSETS+'/yaneuraou.data'),policy:hash(M+'/quiet-policy.txt'),binary:hash(BIN)});
const devRound=process.env.V14_DEV_ROUND||'';
const devNames=devRound?['base','capture','policy1capture','capturelmr','policy1capturelmr']:['base','policy1','policy4','policy16','lmr','policy4lmr'];
const protocol=existsSync(D+'/frozen.json')?read(D+'/frozen.json'):null;
if(!['dev','freeze'].includes(mode)&&protocol&&JSON.stringify(signatures())!==JSON.stringify(protocol.signatures))throw Error('Frozen signature mismatch');
const teacher=['dev','collect','quality'].includes(mode)?await yaneura(undefined,{allLegalMoves:true}):null;
const matchBegin=Number(process.env.V14_MATCH_BEGIN||0),matchEnd=Number(process.env.V14_MATCH_END||48);
const marker=mode==='matches'&&process.env.V14_MATCH_BEGIN?D+'/.match-worker-'+matchBegin:null;
if(marker)writeFileSync(marker,String(process.pid));
try {
 if(mode==='dev'||mode==='quality'){
  const dirname=mode==='dev'?'development'+devRound:'quality';mkdirSync(D+'/'+dirname,{recursive:true});
  const roots=read(mode==='dev'?ROOT+'/results/v0.13/roots.json':D+'/roots.json');
  const names=mode==='dev'?devNames:protocol.names;
  const budgets=mode==='dev'?[{nodes:12000},{nodes:48000}]:[{nodes:12000},{nodes:48000},{ms:1000}];
  for(let id=0;id<roots.length;id++){
   const path=D+'/'+dirname+'/'+String(id).padStart(3,'0')+'.json';if(existsSync(path))continue;
   const root=roots[id],row={id,root,runs:[]};
   for(const budget of budgets)for(let j=0;j<names.length;j++){
    const name=names[(id+j)%names.length];
    const args=['--depth',16,'--iterative','--max-nodes',budget.nodes||1000000000];if(budget.ms)args.push('--time-ms',budget.ms);
    row.runs.push({budget,...await run(root,name,args)});
   }
   await teacher.reset();const unrestricted=await teacher.search(root.prefix,{depth:10});
   const moves=[...new Set([...row.runs.map(r=>r.chosenMove),unrestricted.move])];
   await teacher.reset();const scored=await teacher.search(root.prefix,{depth:10,multipv:moves.length,searchmoves:moves});
   const ranks=new Map();for(const i of scored.infos)if(!i.bound&&moves.includes(i.pv[0]))ranks.set(i.pv[0],i);
   if(ranks.size!==moves.length)throw Error('Incomplete teacher');
   const candidates=moves.map(move=>({move,...ranks.get(move)}));
   for(const c of candidates){validate(recordAt(START,root.prefix).position,c.move,c.pv);if(c.type==='cp'&&c.depth<10)throw Error('Incomplete depth');}
   Object.assign(row,{unrestricted,scored,candidates});save(path,row);console.log(JSON.stringify({mode,id,candidates:candidates.map(c=>[c.move,c.type,c.score])}));
  }
 }else if(mode==='freeze'){
  if(protocol)throw Error('Already frozen');
  const selected=read(D+'/development-selection.json');
  save(D+'/frozen.json',{seed:2026092114,signatures:signatures(),selected,names:['base',selected.policy,selected.offline,selected.selective],games:24,
   fixed:{depth:3,repeats:3,nodes:2000000},quality:{nodes:[12000,48000],ms:1000,teacherDepth:10},matches:{starts:8,nodes:12000,maxPlies:200},
   limitations:'shared opening families; historical fixed teacher; 24 trajectories are not independent per-node samples'});
  console.log('Frozen',selected);
 }else if(mode==='collect'){
  mkdirSync(D+'/games',{recursive:true});
  const openings=read(ROOT+'/results/v0.13/protocol.json');
  const initialGames=Array.from({length:24},(_,id)=>read(ROOT+'/results/v0.13/games/'+String(id).padStart(2,'0')+'.json'));
  for(let id=0;id<protocol.games;id++){
   const path=D+'/games/'+String(id).padStart(2,'0')+'.json';if(existsSync(path))continue;
   let seed=(protocol.seed+id*7919)>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
   const prefix=[...initialGames[id].opening],record=recordAt(START,prefix),game={id,seed,opening:[...prefix],rows:[],status:'running'};await teacher.reset();
   for(let offset=0;offset<48;offset++){
    if(record.repetition||!hasLegalMove(record.position))break;
    const a=await teacher.search(prefix,{depth:6,multipv:3}),ranks=new Map();for(const i of a.infos)if(!i.bound)ranks.set(i.rank,i);
    const cs=[...ranks.values()].sort((a,b)=>a.rank-b.rank);for(const c of cs)validate(record.position,c.pv[0],c.pv);
    const eligible=cs.filter(c=>c.type==='cp'&&c.score>=cs[0].score-(offset<16?180:80));
    const move=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
    game.rows.push({game:id,offset,ply:prefix.length,prefix:[...prefix],sfen:record.position.sfen,checked:record.position.checked,candidates:cs,selected:move});
    if(!record.append(validate(record.position,move)))throw Error('Append failed');prefix.push(move);
   }
   game.status='finished';save(path,game);console.log(JSON.stringify({mode,id,rows:game.rows.length}));
  }
 }else if(mode==='fixed'||mode==='devfixed'){
  // Equal-node games may run independently. Wall-clock measurements wait for them.
  const waitStart=Date.now();
  while(readdirSync(D).some(n=>n.startsWith('.match-worker-'))){
   if(Date.now()-waitStart>60000)throw Error('Match workers still active: rerun fixed after they finish');
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  const roots=read(mode==='devfixed'?ROOT+'/results/v0.13/roots.json':D+'/roots.json');
  const names=mode==='devfixed'?devNames:protocol.names;const dirname=mode+(mode==='devfixed'?devRound:'');mkdirSync(D+'/'+dirname,{recursive:true});
  for(let rep=0;rep<(mode==='devfixed'?1:3);rep++)for(let id=0;id<roots.length;id++)for(let j=0;j<names.length;j++){
   const name=names[(rep+id+j)%names.length],path=D+'/'+dirname+'/'+String(id).padStart(3,'0')+'-'+name+'-'+rep+'.json';if(existsSync(path))continue;
   const analysis=await run(roots[id],name,['--depth',3,'--max-nodes',2000000]);save(path,{id,rep,root:roots[id],analysis});
   console.log(JSON.stringify({mode,id,rep,name,nodes:analysis.nodes,complete:analysis.complete}));
  }
 }else if(mode==='matches'){
  mkdirSync(D+'/matches',{recursive:true});const starts=read(D+'/roots.json').slice(0,8),plans=[];
  for(const name of protocol.names.slice(1))for(const root of starts)for(const side of ['black','white'])plans.push({id:`${name}-base-${root.game}-${side}`,pair:[name,'base'],root,candidateSide:side});
  const other=c=>c==='black'?'white':'black';
  for(let i=matchBegin;i<Math.min(matchEnd,plans.length);i++){
   const p=plans[i],path=D+'/matches/'+p.id+'.json';if(existsSync(path))continue;
   const game={...p,moves:[],result:null},prefix=[...p.root.prefix],record=recordAt(START,prefix),initial=record.position.sfen;
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
 }else throw Error('Unknown mode '+mode);
}finally{teacher?.close();if(marker&&existsSync(marker))unlinkSync(marker);}
