import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
export const D=ROOT+'/results/v0.17';
const read=p=>JSON.parse(readFileSync(p));export const save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
export const names=['baseline','adaptive','quiet','root','all','cost','roundrobin','puct','halving','reliability'];
export function args(name){
 if(!names.includes(name))throw Error('Unknown variant');
 const a=['--advanced','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history'];
 if(name==='baseline')a.push('--depth','16','--iterative');else a.push('--driver','adaptive');
 if(name==='quiet')a.push('--policy-model',ROOT+'/models/v0.14/quiet-policy.txt');
 if(['root','all','cost','puct','halving','reliability'].includes(name))a.push('--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode',name==='root'?'root':name==='all'?'all':'cost');
 if(['roundrobin','puct','halving','reliability'].includes(name))a.push('--root-scheduler',name);
 return a;
}
export async function run(prefix,name,ms,initial=START){
 const r=await lab(prefix,[...args(name),'--max-nodes','1000000000','--time-ms',String(ms)],initial),pv=r.has_result?r.pv:r.fallback_pv;
 if(!pv.length||checkedPV(recordAt(initial,prefix).position,pv).length!==pv.length)throw Error('Illegal lab PV');
 return {...r,chosenMove:pv[0],variant:name};
}
export function signatures(){return {binary:hash(BIN),policy:hash(ROOT+'/models/v0.17/all-policy.txt'),base:hash(ASSETS+'/yaneuraou.data'),opponent:hash(ASSETS+'/yaneuraou.wasm')};}
async function main(){
 const mode=process.argv[2];
 if(mode==='freeze'){
  if(existsSync(D+'/protocol.json'))throw Error('Already frozen');
  save(D+'/protocol.json',{version:'0.17',at:new Date().toISOString(),baseGitHub:'21e17c1636f883c977425c6dec07f564d9772720',signatures:signatures(),dev:{games:[6,7],indices:[15,35,55,75],ms:[300,1000],names},test:{games:[8,9],indices:[15,25,35,45,55,65,75],ms:[1000,3000,5000,10000],variants:'baseline, adaptive, root, and lowest development teacher-gap new method (if different)',teacherDepth:12},matches:{variants:'adaptive and selected new method',ms:[3000,5000],opponentMs:2000,openings:[[],['7g7f','3c3d','2g2f','5c5d','2f2e','8b5b']],colors:['black','white'],maxPlies:200},allocation:'Complete quiescence per root arm required for coverage. Value TT and move history persist between node slices, recursive stacks do not. Latest values at heterogeneous effort are heuristic. All arms initially probed; halving restarts reintroduce arms.',runtime:'Candidates native C++/AVX2 versus historical YaneuraOu6.03 WASM, one search thread. All quality jobs sequential. Match workers pinned to distinct virtual cores, no more than 4 concurrently; record CPU quota. Model/process startup excluded from search budget. No book or ponder. Search state reset each move.'});
  console.log('frozen');return;
 }
 const P=read(D+'/protocol.json');if(JSON.stringify(P.signatures)!==JSON.stringify(signatures()))throw Error('Frozen signature mismatch');
 if(mode==='dev'||mode==='test'){
  const spec=P[mode],variants=mode==='dev'?names:read(D+'/selection.json').testVariants;mkdirSync(D+'/'+mode,{recursive:true});
  const roots=[];
  for(const gid of spec.games){const game=read(D+'/selfplay/'+gid+'.json');for(const ix of spec.indices){const row=game.rows[ix];if(!row)throw Error('Missing root');roots.push({id:gid+'-'+ix,game:gid,prefix:row.prefix,sfen:row.sfen});}}
  save(D+'/'+mode+'-roots.json',roots);
  for(let i=0;i<roots.length;i++)for(const ms of spec.ms){
   const root=roots[i],path=D+'/'+mode+'/'+root.id+'-'+ms+'.json';if(existsSync(path))continue;
   const runs=[];for(let j=0;j<variants.length;j++){const name=variants[(i+j)%variants.length];runs.push(await run(root.prefix,name,ms));}
   save(path,{root,ms,runs});console.log(JSON.stringify({mode,root:root.id,ms,runs:runs.map(r=>[r.variant,r.chosenMove,r.completed_depth,r.stats.root_covered])}));
  }
 }else if(mode==='score-dev'||mode==='score-test'){
  const part=mode.slice(6),teacher=await yaneura(undefined,{allLegalMoves:true});mkdirSync(D+'/'+part+'-teacher',{recursive:true});
  try{for(const root of read(D+'/'+part+'-roots.json')){
   const path=D+'/'+part+'-teacher/'+root.id+'.json';if(existsSync(path))continue;
   const chosen=P[part].ms.flatMap(ms=>read(D+'/'+part+'/'+root.id+'-'+ms+'.json').runs.map(r=>r.chosenMove));
   await teacher.reset();const unrestricted=await teacher.search(root.prefix,{depth:12}),moves=[...new Set([...chosen,unrestricted.move])];
   await teacher.reset();const scored=await teacher.search(root.prefix,{depth:12,multipv:moves.length,searchmoves:moves}),found=new Map();
   for(const x of scored.infos)if(!x.bound&&moves.includes(x.pv[0]))found.set(x.pv[0],x);
   if(found.size!==moves.length)throw Error('Incomplete teacher scores');
   const candidates=moves.map(move=>({move,...found.get(move)}));
   for(const c of candidates)if(c.depth<12||checkedPV(recordAt(START,root.prefix).position,c.pv).length!==c.pv.length)throw Error('Invalid teacher score PV');
   save(path,{root,candidates,unrestricted,scored});console.log(JSON.stringify({mode,root:root.id,candidates:candidates.map(c=>[c.move,c.type,c.score])}));
  }}finally{teacher.close();}
 }else if(mode==='fallback'){
  const old=read(ROOT+'/results/v0.16/fallback-replay.json'),roots=old.rows.filter(r=>r.variant==='baseline'),rows=[];
  for(const root of roots)for(const name of ['adaptive','root','cost','roundrobin','puct','halving','reliability']){
   const result=await run(root.prefix,name,1000);rows.push({ply:root.ply,prefix:root.prefix,analysis:result});console.log(JSON.stringify({mode,ply:root.ply,name,has:result.has_result,covered:result.stats.root_covered,arms:result.stats.root_arms}));
  }save(D+'/fallback-replay.json',{selection:'Known v0.16 failure cases; post-hoc development diagnostics',rows});
 }else throw Error('freeze|dev|score-dev|test|score-test|fallback');
}
if(process.argv[1]?.endsWith('experiment_v17.mjs'))await main();
