import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
export const D=process.env.V18_RESULTS||ROOT+'/results/v0.18';
export const read=p=>JSON.parse(readFileSync(p));
export function save(p,x){mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);}
export const variants=['root','cache','guard','both'];
export function args(name){
 if(!variants.includes(name))throw Error('Unknown variant');
 const extra=(name==='cache'||name==='both'?',qcache':'')+(name==='guard'||name==='both'?',qguard':'');
 return ['--advanced','--driver','adaptive','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history'+extra,'--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode','root'];
}
export function signatures(){return {binary:hash(BIN),policy:hash(ROOT+'/models/v0.17/all-policy.txt'),data:hash(ASSETS+'/yaneuraou.data'),opponent:hash(ASSETS+'/yaneuraou.wasm')};}
export function checkProtocol(){const p=read(D+'/protocol.json');if(JSON.stringify(p.signatures)!==JSON.stringify(signatures()))throw Error('Frozen signature mismatch');return p;}
export async function run(prefix,name,ms,extra=[]){
 const a=await lab(prefix,[...args(name),'--max-nodes','1000000000',...(ms?['--time-ms',String(ms)]:[]),...extra]);
 const pv=a.has_result?a.pv:a.fallback_pv;
 if(!pv.length||checkedPV(recordAt(START,prefix).position,pv).length!==pv.length)throw Error('Invalid PV');
 return {...a,variant:name,chosenMove:pv[0]};
}
async function scoreRoots(part,roots,teacher){
 for(const root of roots){
  const path=D+'/'+part+'-teacher/'+root.id+'.json';if(existsSync(path))continue;
  const files=part==='dev'?[500]:[1000,3000,5000,10000];
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
  const roots=read(ROOT+'/results/v0.16/roots.json').slice(0,8).map(r=>({...r,id:'dev-'+r.id}));
  save(D+'/dev-roots.json',roots);
  save(D+'/protocol.json',{version:'0.18',date:new Date().toISOString(),sourceCommit:'b986fdb6d4362e79fc726de0511cf712f762b583',signatures:signatures(),dev:{roots:8,ms:500,variants,selection:'Lowest mean common-candidate cp gap, excluding mate roots; tie order cache,guard,both. Always compare against root.'},test:{trajectorySeeds:[18301,18302,18303,18304],plies:64,indices:[24,40,56],ms:[1000,3000,5000,10000],variants:'root and selected',teacherDepth:12,repeats:1},matches:{opening:[],sides:['black','white'],ourMs:[3000,5000],opponentMs:2000,variants:'root and selected',maxPlies:200},notes:['New teacher trajectories, not guaranteed unseen training positions. Four correlated trajectory clusters.','No depth or beam limit for our adaptive search; 95-ply emergency stop retained.','qcache uses collision-free full-history path identities; qguard changes the searched game tree.','Search time excludes process/model startup; teacher native-WASM contrast retained.','No v0.17 result logs were present in source branch; prior numerical claims are not reconstructed.']});
  console.log('frozen');return;
 }
 const P=checkProtocol();
 if(mode==='dev'||mode==='test'){
  const roots=read(D+'/'+mode+'-roots.json'),names=mode==='dev'?variants:['root',read(D+'/selection.json').selected],budgets=mode==='dev'?[500]:P.test.ms;
  for(let i=0;i<roots.length;i++)for(const ms of budgets){
   const root=roots[i],path=D+'/'+mode+'/'+root.id+'-'+ms+'.json';if(existsSync(path))continue;
   const runs=[];for(let j=0;j<names.length;j++)runs.push(await run(root.prefix,names[(i+j)%names.length],ms));
   save(path,{root,ms,runs});console.log(JSON.stringify({mode,id:root.id,ms,moves:runs.map(r=>[r.variant,r.chosenMove,r.completed_depth,r.nodes])}));
  }
 }else if(mode==='score-dev'||mode==='score-test'){
  const teacher=await yaneura(undefined,{allLegalMoves:true});try{await scoreRoots(mode.slice(6),read(D+'/'+mode.slice(6)+'-roots.json'),teacher);}finally{teacher.close();}
 }else if(mode==='select'){
  const totals=Object.fromEntries(variants.map(v=>[v,{gap:0,n:0}]));
  for(const root of read(D+'/dev-roots.json')){
   const cs=read(D+'/dev-teacher/'+root.id+'.json').candidates;if(cs.some(c=>c.type!=='cp'||Math.abs(c.score)>=30000))continue;
   const scores=Object.fromEntries(cs.map(c=>[c.move,c.score])),best=Math.max(...Object.values(scores));
   for(const r of read(D+'/dev/'+root.id+'-500.json').runs){totals[r.variant].gap+=best-scores[r.chosenMove];totals[r.variant].n++;}
  }
  for(const t of Object.values(totals)){if(!t.n)throw Error('No cp roots');t.meanGap=t.gap/t.n;}
  const selected=['cache','guard','both'].sort((a,b)=>totals[a].meanGap-totals[b].meanGap)[0];
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
  const audits=[];for(const root of roots.slice(0,3)){const analysis=await run(root.prefix,'guard',0,['--max-nodes','100000','--qguard-audit','--trace',D+'/audit-'+root.ply+'.jsonl']);audits.push({ply:root.ply,prefix:root.prefix,analysis});}
  save(D+'/audit.json',{notes:'Counters are correlated visits, not independent samples. Audit consumes the common node budget.',rows:audits});
 }else throw Error('Unknown mode');
}
if(process.argv[1]?.endsWith('experiment_v18.mjs'))await main();
