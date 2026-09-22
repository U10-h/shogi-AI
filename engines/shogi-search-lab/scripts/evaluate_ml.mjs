// Validation uses fixed nodes, held-out tests use sequential timed searches.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
const stage=process.argv[2],shard=Number(process.argv[3]||0),shards=Number(process.argv[4]||1);
if(!['naive','rebuild','biascontrol','test'].includes(stage))throw Error('Specify naive/rebuild/biascontrol/test');
if(stage==='test'&&shards!==1)throw Error('Timed tests must run serially');
const D=ROOT+'/results/v0.10',frozen=stage==='test'?JSON.parse(readFileSync(D+'/frozen-model.json')):null;
const names=stage==='naive'?['base','naive']:stage==='rebuild'?['base','naive','anchored25','anchored50']:stage==='biascontrol'?['base','anchored50','tempo40']:['base',frozen.selected];
const models=Object.fromEntries(names.map(n=>[n,n==='base'?ASSETS+'/yaneuraou.data':ROOT+'/build/models/v0.10/'+n+'.nnue']));
if(frozen&&hash(models[frozen.selected])!==frozen.modelSha256)throw Error('Frozen model mismatch');
const roots=JSON.parse(readFileSync(D+'/'+(stage==='test'?'test':'validation')+'-roots.json'));
const tasks=roots.map((r,i)=>({root:i,...r,ms:stage==='test'?1000:null}));
if(stage==='test')for(let i=0;i<24;i++)tasks.push({root:i*4,...roots[i*4],ms:3000});
const dir=D+'/quality-'+stage;mkdirSync(dir,{recursive:true});
const pending=D+'/quality-'+stage+'-pending';mkdirSync(pending,{recursive:true});
const teacher=await yaneura(undefined,{allLegalMoves:stage==='test'});
const signatures=Object.fromEntries(Object.entries(models).map(([n,p])=>[n,hash(p)]));
try {for(let task=shard;task<tasks.length;task+=shards) {
 const root=tasks[task],path=dir+'/'+String(task).padStart(3,'0')+'.json';
 if(existsSync(path)){
  const old=JSON.parse(readFileSync(path));
  if(old.status==='finished'&&JSON.stringify(old.modelHashes)===JSON.stringify(signatures))continue;
  throw Error('Existing quality record is incomplete or models changed');
 }
 const pendingPath=pending+'/'+String(task).padStart(3,'0')+'.json';
 const record=recordAt(START,root.prefix),row=existsSync(pendingPath)?JSON.parse(readFileSync(pendingPath)):{stage,task,...root,binarySha256:hash(BIN),modelHashes:signatures,runs:[]};
 if(row.binarySha256!==hash(BIN)||JSON.stringify(row.modelHashes)!==JSON.stringify(signatures))throw Error('Pending result hash mismatch');
 for(let j=row.runs.length;j<names.length;j++){
  const name=names[(task+j)%names.length];
  const args=['--advanced','--preset','tactical','--eval','nnue','--eval-model',models[name],'--depth','16','--iterative','--max-nodes',stage==='test'?'1000000000':'20000'];
  if(root.ms)args.push('--time-ms',String(root.ms));
  const r=await lab(root.prefix,args);let move=r.bestmove;
  if(!r.has_result){const state=await lab(root.prefix,['--legal']);move=state.moves[0];r.fallback=true;}
  if(!move||checkedPV(record.position,r.pv).length!==r.pv.length)throw Error('Invalid student move/PV');
  const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m))throw Error('Illegal chosen move');
  row.runs.push({variant:name,chosenMove:move,...r});
 }
 if(!existsSync(pendingPath))writeFileSync(pendingPath,JSON.stringify(row));
 row.teacherAllLegalMoves=stage==='test';
 await teacher.reset();row.teacherUnrestricted=await teacher.search(root.prefix,{depth:10});
 const moves=[...new Set([row.teacherUnrestricted.move,...row.runs.map(r=>r.chosenMove)])];
 await teacher.reset();row.teacher=await teacher.search(root.prefix,{depth:10,multipv:moves.length,searchmoves:moves});
 const ranked=new Map();for(const i of row.teacher.infos)if(i.depth===10&&!i.bound&&moves.includes(i.pv[0]))ranked.set(i.pv[0],i);
 if(ranked.size!==moves.length){
  // A proven mate may finish before target depth; retain the actual depth.
  const final=new Map();for(const i of row.teacher.infos)if(!i.bound&&moves.includes(i.pv[0]))final.set(i.pv[0],i);
  if(final.size!==moves.length)throw Error('Incomplete teacher candidate set');
  for(const [m,c] of final)if(!ranked.has(m)){if(c.type!=='mate')throw Error('Incomplete non-mate teacher depth');ranked.set(m,c);}
 }
 row.candidates=moves.map(m=>({move:m,...ranked.get(m)}));
 for(const c of row.candidates)if(checkedPV(record.position,c.pv).length!==c.pv.length)throw Error('Invalid teacher PV');
 const cpOnly=row.candidates.every(c=>c.type==='cp');
 const utility=c=>c.type==='cp'?c.score:Math.sign(c.score)*(1000000-Math.abs(c.score));
 const best=Math.max(...row.candidates.map(utility));
 for(const r of row.runs){const c=ranked.get(r.chosenMove);r.teacherScore=c;r.teacherGapCp=cpOnly?best-c.score:null;r.teacherUtilityGap=best-utility(c);}
 row.status='finished';writeFileSync(path,JSON.stringify(row));
 console.log(JSON.stringify({stage,task,game:root.game,ms:root.ms,runs:row.runs.map(r=>({name:r.variant,depth:r.completed_depth,gap:r.teacherGapCp,move:r.chosenMove,fallback:r.fallback||false}))}));
}}finally{teacher.close();}
