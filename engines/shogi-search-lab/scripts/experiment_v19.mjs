import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
export const D=process.env.V19_RESULTS||ROOT+'/results/v0.19';
export const read=p=>JSON.parse(readFileSync(p));
export function save(p,x){mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);}
export const variants=['root','legacy','all8','all32','entry1','entry8'];
export function args(name){
 if(![...variants,'base'].includes(name))throw Error('Unknown variant');
 const cache=!['root','base'].includes(name);
 const setting={legacy:[1,'all'],all8:[8,'all'],all32:[32,'all'],entry1:[1,'entry'],entry8:[8,'entry']}[name];
 return ['--advanced','--driver','adaptive','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history'+(cache?',qcache':''),'--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode','root',...(setting?['--qcache-min-nodes',String(setting[0]),'--qcache-scope',setting[1]]:[])];
}
export function signatures(){return {binary:hash(BIN),referenceBinary:hash(ROOT+'/build/shogi-lab-v0.18'),policy:hash(ROOT+'/models/v0.17/all-policy.txt'),data:hash(ASSETS+'/yaneuraou.data'),opponent:hash(ASSETS+'/yaneuraou.wasm')};}
export function checkProtocol(){const p=read(D+'/protocol.json');if(JSON.stringify(p.signatures)!==JSON.stringify(signatures()))throw Error('Frozen signature mismatch');return p;}
export async function run(prefix,name,ms,extra=[]){
 const a=await lab(prefix,[...args(name),'--max-nodes','1000000000',...(ms?['--time-ms',String(ms)]:[]),...extra],START,name==='base'?ROOT+'/build/shogi-lab-v0.18':BIN);
 const pv=a.has_result?a.pv:a.fallback_pv;
 if(!pv.length||checkedPV(recordAt(START,prefix).position,pv).length!==pv.length)throw Error('Invalid PV');
 return {...a,variant:name,chosenMove:pv[0]};
}
async function scoreRoots(part,roots,teacher){
 for(const root of roots){
  const path=D+'/'+part+'-teacher/'+root.id+'.json';if(existsSync(path))continue;
  const files=part==='dev'?[500]:read(D+'/protocol.json').test.ms;
  const chosen=files.flatMap(ms=>read(D+'/'+part+'/'+root.id+'-'+ms+'.json').runs.map(r=>r.chosenMove));
  await teacher.reset();const unrestricted=await teacher.search(root.prefix,{depth:12});
  const moves=[...new Set([...chosen,unrestricted.move])];
  await teacher.reset();const response=await teacher.search(root.prefix,{depth:12,multipv:moves.length,searchmoves:moves});
  const found=new Map();for(const x of response.infos)if(!x.bound&&moves.includes(x.pv[0])&&x.depth>=12)found.set(x.pv[0],x);
  if(found.size!==moves.length)throw Error('Incomplete teacher scoring');
  const candidates=moves.map(m=>({move:m,...found.get(m)}));
  for(const c of candidates)if(checkedPV(recordAt(START,root.prefix).position,c.pv).length!==c.pv.length)throw Error('Teacher PV illegal');
  save(path,{root,candidates,unrestricted,response});console.log(JSON.stringify({part,scored:root.id}));
 }
}
async function main(){
 const mode=process.argv[2];
 if(mode==='freeze'){
  if(existsSync(D+'/protocol.json'))throw Error('Already frozen');
  const roots=[...read(ROOT+'/results/v0.18/dev-roots.json'),...read(ROOT+'/results/v0.18/test-roots.json').map(r=>({...r,id:'prior-'+r.id}))];
  save(D+'/dev-roots.json',roots);
  save(D+'/protocol.json',{version:'0.19',date:new Date().toISOString(),sourceCommit:'00e7c5de859fcbf8af46446ec96e8eef3af8d4d7',signatures:signatures(),dev:{roots:20,ms:500,variants,selection:'Among root/all8/all32/entry1/entry8, lowest mean common-candidate cp gap; tie: highest mean completed iteration, then listed order. Legacy is diagnostic only. Incomplete first iteration remains in quality scoring through fallback move.'},test:{trajectorySeeds:[19301,19302,19303,19304],plies:64,indices:[24,40,56],ms:[1000,3000,5000],variants:'base (v0.18 root) and selected v0.19',teacherDepth:12,repeats:1},matches:{opening:[],sides:['black','white'],ourMs:[3000,5000],opponentMs:2000,variants:'base and selected',maxPlies:200},notes:['All development positions previously used; new teacher seeds only for evaluation, no guaranteed training disjointness.','Cost threshold affects caching, never which moves are legal/searched. Full history path IDs retained.','Cached observed work is an estimate, not measured time saved.','No fixed depth/beam limit; 95-ply emergency stop. No qguard in candidates.','Root model and NNUE unchanged. Cache defaults remain v0.18-compatible until evidence assessed.','Search time excludes process startup. Native/WASM opponent difference retained.']});
  console.log('frozen');return;
 }
 const P=checkProtocol();
 if(mode==='dev'||mode==='test'){
  const roots=read(D+'/'+mode+'-roots.json'),names=mode==='dev'?variants:['base',read(D+'/selection.json').selected],budgets=mode==='dev'?[500]:P.test.ms;
  for(let i=0;i<roots.length;i++)for(const ms of budgets){
   const root=roots[i],path=D+'/'+mode+'/'+root.id+'-'+ms+'.json';if(existsSync(path))continue;
   const runs=[];for(let j=0;j<names.length;j++)runs.push(await run(root.prefix,names[(i+j)%names.length],ms));
   save(path,{root,ms,runs});console.log(JSON.stringify({mode,id:root.id,ms,moves:runs.map(r=>[r.variant,r.chosenMove,r.completed_depth,r.nodes])}));
  }
 }else if(mode==='score-dev'||mode==='score-test'){
  const teacher=await yaneura(undefined,{allLegalMoves:true});try{await scoreRoots(mode.slice(6),read(D+'/'+mode.slice(6)+'-roots.json'),teacher);}finally{teacher.close();}
 }else if(mode==='select'){
  const totals=Object.fromEntries(variants.map(v=>[v,{gap:0,n:0,iterations:0}]));
  for(const root of read(D+'/dev-roots.json')){
   const cs=read(D+'/dev-teacher/'+root.id+'.json').candidates;if(cs.some(c=>c.type!=='cp'||Math.abs(c.score)>=30000))continue;
   const scores=Object.fromEntries(cs.map(c=>[c.move,c.score])),best=Math.max(...Object.values(scores));
   for(const r of read(D+'/dev/'+root.id+'-500.json').runs){totals[r.variant].gap+=best-scores[r.chosenMove];totals[r.variant].n++;totals[r.variant].iterations+=r.completed_depth;}
  }
  for(const t of Object.values(totals)){if(!t.n)throw Error('No cp roots');t.meanGap=t.gap/t.n;}
  const selected=['root','all8','all32','entry1','entry8'].sort((a,b)=>totals[a].meanGap-totals[b].meanGap||totals[b].iterations-totals[a].iterations)[0];
  const result={selected,totals,at:new Date().toISOString(),rule:P.dev.selection};save(D+'/selection.json',result);console.log(JSON.stringify(result));
 }else if(mode==='collect'){
  const teacher=await yaneura(D+'/trajectory-usi.jsonl',{allLegalMoves:true}),roots=[];
  try{for(let game=0;game<P.test.trajectorySeeds.length;game++){
   const path=D+'/trajectories/'+game+'.json';let rows;
   if(existsSync(path)){rows=read(path).rows;}
   else{
    let seed=P.test.trajectorySeeds[game];const rng=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
    const prefix=[];rows=[];
    for(let ply=0;ply<P.test.plies;ply++){
     const state=await lab(prefix,['--legal']);if(!state.moves.length||state.repetition_score!==null)throw Error('Trajectory ended before preregistered positions');
     await teacher.reset();const result=await teacher.search(prefix,{depth:8,multipv:3});
     const candidates=new Map();for(const x of result.infos)if(!x.bound&&x.depth>=8)candidates.set(x.rank,x);
     const best=candidates.get(1);if(!best)throw Error('No teacher first PV');
     const eligible=[...candidates.values()].filter(x=>x.type==='cp'&&best.type==='cp'&&best.score-x.score<=100);
     const move=ply<20&&eligible.length?eligible[Math.floor(rng()*eligible.length)].pv[0]:result.move;
     if(!state.moves.includes(move))throw Error('Teacher illegal');
     rows.push({prefix:[...prefix],sfen:state.sfen,move,response:result});prefix.push(move);
    }
    save(path,{game,seed:P.test.trajectorySeeds[game],rows});console.log(JSON.stringify({trajectory:game,plies:rows.length}));
   }
   for(const i of P.test.indices){const r=rows[i];roots.push({id:game+'-'+i,game,prefix:r.prefix,sfen:r.sfen});}
  }}finally{teacher.close();}
  const keys=new Set(roots.map(r=>r.sfen.split(' ').slice(0,3).join(' ')));if(keys.size!==roots.length)throw Error('Duplicate roots');save(D+'/test-roots.json',roots);
 }else if(mode==='diagnose'){
  const roots=read(ROOT+'/results/v0.16/fallback-replay.json').rows.filter(r=>r.variant==='baseline'),rows=[];
  if(!existsSync(D+'/fallback.json')) {
   for(const root of roots)for(const name of variants){const analysis=await run(root.prefix,name,1000);rows.push({ply:root.ply,prefix:root.prefix,analysis});}
   save(D+'/fallback.json',{selection:'Known v0.16 failed-first-iteration positions; diagnostic only',rows});
  }

 }else throw Error('Unknown mode');
}
if(process.argv[1]?.endsWith('experiment_v19.mjs'))await main();
