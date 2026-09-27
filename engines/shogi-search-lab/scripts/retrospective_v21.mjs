// Frozen, serial retrospective validation. No model or search parameter tuning.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
export const D=process.env.V21_RESULTS||ROOT+'/results/retrospective-20260927';
export const read=p=>JSON.parse(readFileSync(p));
export function save(p,x){mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);}
export const names=['traditional','capture','lmr','adaptive','latest'];
export function args(name){
 const f=['tt','history','killer','counter','mate-distance','qsearch'];
 if(name!=='traditional')f.push('capture-history');
 if(name==='lmr')f.push('lmr');
 const adapt=['adaptive','latest','nocache','scalar'].includes(name);
 const a=['--advanced','--driver',adapt?'adaptive':'pvs','--eval',name==='nocache'?'nnue':name==='scalar'?'nnue-scalar':'nnue-cache','--eval-model',ASSETS+'/yaneuraou.data','--features',f.join(','),'--depth','16','--iterative'];
 if(['latest','nocache','scalar'].includes(name))a.push('--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode','root');
 if(name==='scalar')a.push('--eager-order');
 return a;
}
const key=s=>s.split(' ').slice(0,3).join(' ');
const other=c=>c==='black'?'white':'black';
async function run(root,name,ms,nodes=1000000000){
 const start=performance.now();const a=await lab(root.prefix,[...args(name),'--max-nodes',String(nodes),...(ms?['--time-ms',String(ms)]:[])]);
 const wallMs=performance.now()-start,pv=a.has_result?a.pv:a.fallback_pv;
 if(!pv.length||checkedPV(recordAt(START,root.prefix).position,pv).length!==pv.length)throw Error('Invalid PV '+root.id+' '+name);
 return {...a,variant:name,chosenMove:pv[0],pvLength:pv.length,wallMs};
}
async function freeze(){
 if(existsSync(D+'/protocol.json'))throw Error('Already frozen');
 save(D+'/protocol.json',{date:new Date().toISOString(),source:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),script:hash(new URL(import.meta.url)),binary:hash(BIN),model:hash(ASSETS+'/yaneuraou.data'),policy:hash(ROOT+'/models/v0.17/all-policy.txt'),names,args:Object.fromEntries([...names,'nocache','scalar'].map(n=>[n,args(n)])),seeds:[270901,270902,270903,270904,270905,270906,270907,270908],plies:[28,44,60],qualityMs:[300,1000,3000],latestExtraMs:5000,speedNodes:100000,speedRepeats:3,teacherDepth:12,matchMs:200,opponentMs:1000,maxAdditionalPlies:200,pairs:[['latest','capture'],['latest','lmr'],['capture','traditional']],pairOpeningCount:6,yaneuraOpeningCount:2,yaneuraVariants:['latest','capture'],hardMs:[1000,3000],notes:['No outcome-driven selection or parameter tuning.','All time measurements serial, fresh engine/search state per move.','Same NNUE cache for the five main methods.','New seeds only; old roots exact-overlap checked, complete training disjointness not claimed.','PVS and PVS+LMR are in-house implementations of established methods, not separate external engines.','Unfinished games remain unresolved, not draws.','8 trajectory clusters for position intervals, start-position pairs for game intervals; no Elo.','Adaptive completed_depth is effort iteration, not comparable plies.','No strict clock forfeits: actual search and launch overhead reported separately.']});
 save(D+'/environment.json',{at:new Date().toISOString(),platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0],cpuCount:os.cpus().length,node:process.version,compiler:execFileSync('g++',['--version'],{encoding:'utf8'}),affinity:readFileSync('/proc/self/status','utf8').split('\n').find(x=>x.startsWith('Cpus_allowed_list')),selftests:existsSync(process.env.V21_SELFTEST_LOG||ROOT+'/build/selftests.txt')?readFileSync(process.env.V21_SELFTEST_LOG||ROOT+'/build/selftests.txt','utf8'):'Selftest log not supplied; run make test before freeze.'});
}
async function collect(){
 const p=read(D+'/protocol.json'),t=await yaneura(D+'/collect-usi.jsonl',{allLegalMoves:true}),roots=[],openings=[];
 save(D+'/opponent.json',{name:t.name,options:t.options,handshake:t.handshake});
 try{for(let game=0;game<p.seeds.length;game++){
  const path=D+'/trajectories/'+game+'.json';let rows;
  if(existsSync(path))rows=read(path).rows;
  else{let seed=p.seeds[game];const rng=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};rows=[];const prefix=[];
   for(let ply=0;ply<=60;ply++){
    const state=await lab(prefix,['--legal']);if(!state.moves.length||state.repetition_score!==null)throw Error('Early terminal trajectory '+game);
    await t.reset();const response=await t.search(prefix,{depth:6,multipv:3});
    const found=new Map();for(const x of response.infos)if(!x.bound&&x.depth>=6)found.set(x.rank,x);
    const first=found.get(1);if(!first)throw Error('Missing collection PV');
    const pool=[...found.values()].filter(x=>first.type==='cp'&&x.type==='cp'&&first.score-x.score<=100);
    const move=ply<32&&pool.length?pool[Math.floor(rng()*pool.length)].pv[0]:response.move;
    if(!state.moves.includes(move))throw Error('Illegal collection move');
    rows.push({prefix:[...prefix],sfen:state.sfen,move,response});prefix.push(move);
   }save(path,{seed:p.seeds[game],rows});
  }
  for(const ply of p.plies)roots.push({id:game+'-'+ply,game,ply,prefix:rows[ply].prefix,sfen:rows[ply].sfen});
  openings.push({id:'opening-'+game,game,prefix:rows[20].prefix,sfen:rows[20].sfen});
  console.log(JSON.stringify({stage:'collect',game,roots:roots.length}));
 }}finally{t.close();}
 const known=new Set();let priorFiles=0;
 for(const v of readdirSync(ROOT+'/results')){if(!v.startsWith('v0.'))continue;const dir=ROOT+'/results/'+v;let files;try{files=readdirSync(dir);}catch{continue;}for(const f of files.filter(f=>/roots.*\.json$/.test(f))){try{const d=read(dir+'/'+f);if(Array.isArray(d)){for(const r of d)if(r.sfen)known.add(key(r.sfen));priorFiles++;}}catch{}}}
 const seen=new Set();for(const r of roots){if(known.has(key(r.sfen))||seen.has(key(r.sfen)))throw Error('Duplicate root '+r.id);seen.add(key(r.sfen));}
 save(D+'/roots.json',roots);save(D+'/openings.json',openings);save(D+'/root-audit.json',{roots:roots.length,priorRootFiles:priorFiles,knownUnique:known.size,exactDuplicates:0,scope:'Saved top-level root JSON files only; not all training/search descendants.'});
}
async function speed(){
 const p=read(D+'/protocol.json'),roots=read(D+'/roots.json');
 for(let rep=0;rep<p.speedRepeats;rep++)for(let i=0;i<roots.length;i++){
  const r=roots[i],path=D+'/speed/'+r.id+'-'+rep+'.json';if(existsSync(path))continue;
  const variants=['nocache','latest','scalar'],runs=[];
  for(let j=0;j<variants.length;j++)runs.push(await run(r,variants[(i+rep+j)%variants.length],0,p.speedNodes));
  for(const a of runs)for(const field of ['score','pv','nodes','completed_depth','stop_reason','has_result','fallback_pv'])if(JSON.stringify(a[field])!==JSON.stringify(runs[0][field]))throw Error('Same-node mismatch '+r.id+' '+field);
  save(path,{root:r,rep,runs,equivalent:true});
 }console.log(JSON.stringify({stage:'speed',finished:true}));
}
async function quality(){
 const p=read(D+'/protocol.json'),roots=read(D+'/roots.json');
 for(let i=0;i<roots.length;i++)for(const ms of [...p.qualityMs,p.latestExtraMs]){
  const r=roots[i],path=D+'/quality/'+r.id+'-'+ms+'.json';if(existsSync(path))continue;
  const ns=ms===p.latestExtraMs?['latest']:names,runs=[];
  for(let j=0;j<ns.length;j++)runs.push(await run(r,ns[(i+j)%ns.length],ms));
  save(path,{root:r,ms,runs});console.log(JSON.stringify({stage:'quality',id:r.id,ms,moves:runs.map(x=>x.chosenMove)}));
 }
}
async function score(){
 const p=read(D+'/protocol.json'),t=await yaneura(D+'/quality-usi.jsonl',{allLegalMoves:true});
 try{for(const r of read(D+'/roots.json')){
  const path=D+'/teacher/'+r.id+'.json';if(existsSync(path))continue;
  const moves=new Set([...p.qualityMs,p.latestExtraMs].flatMap(ms=>read(D+'/quality/'+r.id+'-'+ms+'.json').runs.map(x=>x.chosenMove)));
  await t.reset();const unrestricted=await t.search(r.prefix,{depth:p.teacherDepth});moves.add(unrestricted.move);
  await t.reset();const response=await t.search(r.prefix,{depth:p.teacherDepth,multipv:moves.size,searchmoves:[...moves]});
  const found=new Map();for(const x of response.infos)if(!x.bound&&x.depth>=p.teacherDepth&&moves.has(x.pv[0]))found.set(x.pv[0],x);
  if(found.size!==moves.size)throw Error('Incomplete common candidates '+r.id);
  for(const x of found.values())if(checkedPV(recordAt(START,r.prefix).position,x.pv).length!==x.pv.length)throw Error('Illegal teacher PV');
  save(path,{root:r,candidates:[...found].map(([move,x])=>({move,...x})),unrestricted,response});console.log(JSON.stringify({stage:'score',id:r.id}));
 }}finally{t.close();}
}
async function hard(){
 for(const [i,r]of read(ROOT+'/results/v0.20/hard-roots.json').entries())for(const ms of read(D+'/protocol.json').hardMs){
  const path=D+'/hard/'+i+'-'+ms+'.json';if(existsSync(path))continue;
  const runs=[];for(let j=0;j<names.length;j++)runs.push(await run({...r,id:'hard-'+i},names[(i+j)%names.length],ms));
  save(path,{root:r,ms,runs});console.log(JSON.stringify({stage:'hard',i,ms,completed:runs.map(x=>x.has_result)}));
 }
}
async function matches(){
 const p=read(D+'/protocol.json'),openings=read(D+'/openings.json'),schedule=[];
 for(let i=0;i<p.pairOpeningCount;i++)for(let side=0;side<2;side++)for(const [a,b]of (i%2?[...p.pairs].reverse():p.pairs))schedule.push({id:a+'-'+b+'-'+i+'-'+side,a,b,side,opening:openings[i],ms:p.matchMs,opponentMs:p.matchMs});
 for(let i=0;i<p.yaneuraOpeningCount;i++)for(let side=0;side<2;side++)for(const a of (side?[...p.yaneuraVariants].reverse():p.yaneuraVariants))schedule.push({id:a+'-yaneuraou-'+i+'-'+side,a,b:'yaneuraou',side,opening:openings[i],ms:p.opponentMs,opponentMs:p.opponentMs});
 save(D+'/match-schedule.json',schedule);
 let teacher=null;
 try{for(const spec of schedule){
  const path=D+'/matches/'+spec.id+'.json';if(existsSync(path)&&read(path).status==='finished')continue;
  if(spec.b==='yaneuraou'&&!teacher)teacher=await yaneura(D+'/matches-usi.jsonl');
  const g=existsSync(path)?read(path):{...spec,initial:START,aSide:spec.side===0?'black':'white',status:'running',moves:[],result:null};
  if(g.moves.length)(g.resumptions??=[]).push({at:new Date().toISOString(),afterMove:g.moves.length});
  const record=recordAt(START,[...g.opening.prefix,...g.moves.map(m=>m.usi)]);
  for(let ply=g.moves.length;ply<=p.maxAdditionalPlies;ply++){
   const prefix=[...g.opening.prefix,...g.moves.map(m=>m.usi)],state=await lab(prefix,['--legal']),color=record.position.color;
   if(state.repetition_score!==null){g.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?color:other(color)};break;}
   if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Terminal mismatch');g.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(color)};break;}
   if(ply===p.maxAdditionalPlies)break;
   const variant=color===g.aSide?g.a:g.b,ms=color===g.aSide?g.ms:g.opponentMs;let analysis,move;const start=performance.now();
   if(variant==='yaneuraou'){await teacher.reset();analysis=await teacher.search(prefix,{ms});move=analysis.move;if(move==='resign'){g.result={reason:'resign',winner:other(color)};break;}}
   else {analysis=await run({prefix,id:g.id},variant,ms);move=analysis.chosenMove;}
   const wallMs=performance.now()-start;
   if(!state.moves.includes(move))throw Error('Illegal match move '+g.id);
   const pv=variant==='yaneuraou'?analysis.info?.pv:(analysis.has_result?analysis.pv:analysis.fallback_pv);
   if(pv&&checkedPV(record.position,pv).length!==pv.length)throw Error('Illegal match PV');
   const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Independent move mismatch');
   g.moves.push({ply:prefix.length+1,side:color,variant,usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,analysis,wallMs});save(path,g);
   if(ply%25===0)console.log(JSON.stringify({stage:'match',id:g.id,ply:ply+1}));
  }
  if(!g.result)g.result={reason:'move-limit',winner:null,unresolved:true};g.status='finished';save(path,g);
  const moves=[...g.opening.prefix,...g.moves.map(x=>x.usi)],kif=exportGame({initial:START,moves,result:JSON.stringify(g.result)});
  if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(moves))throw Error('KIF mismatch');writeFileSync(D+'/matches/'+g.id+'.kif',kif);
  console.log(JSON.stringify({stage:'match-finished',id:g.id,result:g.result,plies:moves.length}));
 }}finally{teacher?.close();}
}
const mode=process.argv[2];
if(mode==='freeze')await freeze();
else{
 const p=read(D+'/protocol.json');if(hash(BIN)!==p.binary||hash(ASSETS+'/yaneuraou.data')!==p.model||hash(ROOT+'/models/v0.17/all-policy.txt')!==p.policy)throw Error('Frozen assets mismatch');
 const modes={collect,speed,quality,score,hard,matches};if(mode==='all')for(const f of Object.values(modes))await f();else if(modes[mode])await modes[mode]();else throw Error('Unknown mode');
}
