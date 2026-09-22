import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
export const D=ROOT+'/results/v0.20';
export const read=p=>JSON.parse(readFileSync(p));
export function save(p,x){mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);}
export const variants=['base','cache','fused','fast','continuation','correction','scale75','scale125','see0','see90','see180','seecont'];
export function args(name){
 const f=['tt','history','killer','counter','mate-distance','qsearch','capture-history'];
 let evaluation='nnue',extra=[];
 if(['cache','fused','fast','fast-verify'].includes(name))evaluation='nnue-'+name;
 if(name==='continuation'||name==='seecont')f.push('continuation');
 if(name==='correction')f.push('correction');
 if(name.startsWith('scale'))extra.push('--eval-scale',name.slice(5));
 if(name.startsWith('see')){f.push('qsee');extra.push('--qsee-margin',name==='seecont'?'90':name.slice(3));}
 if(name==='correction0')return [...args('correction'),'--correction-gain','0'];
 if(name==='spsa'){const p=read(D+'/spsa-200k.json');if(!p.complete)throw Error('SPSA incomplete');return [...args('see90'),'--qsee-margin',String(p.final[0]),'--eval-scale',String(p.final[1])];}
 if(name==='winner')return args(read(D+'/selection.json').selected);
 if(name==='combo'){const s=read(D+'/selection.json');return [...args(s.selected),'--eval',s.inference==='original'?'nnue':'nnue-'+s.inference];}
 if(![...variants,'fast-verify'].includes(name))throw Error('Unknown variant '+name);
 return ['--advanced','--driver','adaptive','--eval',evaluation,'--eval-model',ASSETS+'/yaneuraou.data','--features',f.join(','),'--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode','root',...extra];
}
export async function run(root,name,ms,nodes=1000000000,binary=BIN){
 const a=await lab(root.prefix,[...args(name),'--max-nodes',String(nodes),...(ms?['--time-ms',String(ms)]:[])],START,binary);
 const pv=a.has_result?a.pv:a.fallback_pv;
 if(!pv.length||checkedPV(recordAt(START,root.prefix).position,pv).length!==pv.length)throw Error('Illegal PV');
 return {...a,variant:name,chosenMove:pv[0]};
}
const comparable=['score','pv','nodes','completed_depth','stop_reason','has_result','fallback_pv','fallback_score','fallback_source'];
function same(a,b){for(const k of comparable)if(JSON.stringify(a[k])!==JSON.stringify(b[k]))throw Error('Mismatch '+k);}
async function scoring(part){
 const teacher=await yaneura(D+'/'+part+'-teacher-usi.jsonl',{allLegalMoves:true});
 try{for(const root of read(D+'/'+part+'-roots.json')){
  const path=D+'/'+part+'-teacher/'+root.id+'.json';if(existsSync(path))continue;
  const budgets=part==='dev'?[300]:read(D+'/protocol.json').testMs;
  const moves=new Set(budgets.flatMap(ms=>read(D+'/'+part+'/'+root.id+'-'+ms+'.json').runs.map(r=>r.chosenMove)));
  await teacher.reset();const unrestricted=await teacher.search(root.prefix,{depth:12});moves.add(unrestricted.move);
  await teacher.reset();const response=await teacher.search(root.prefix,{depth:12,multipv:moves.size,searchmoves:[...moves]});
  const found=new Map();for(const x of response.infos)if(!x.bound&&moves.has(x.pv[0])&&x.depth>=12)found.set(x.pv[0],x);
  if(found.size!==moves.size)throw Error('Incomplete teacher set');
  const candidates=[...found].map(([move,x])=>({move,...x}));
  for(const x of candidates)if(checkedPV(recordAt(START,root.prefix).position,x.pv).length!==x.pv.length)throw Error('Invalid teacher PV');
  save(path,{root,candidates,unrestricted,response});console.log(JSON.stringify({scored:part,id:root.id}));
 }}finally{teacher.close();}
}
async function main(){
 const mode=process.argv[2];
 if(mode==='freeze'){
  if(existsSync(D+'/protocol.json'))throw Error('Already frozen');
  const roots=[...read(ROOT+'/results/v0.19/dev-roots.json').map(r=>({...r,id:'d-'+r.id})),...read(ROOT+'/results/v0.19/test-roots.json').map(r=>({...r,id:'p-'+r.id}))];
  save(D+'/dev-roots.json',roots);
  save(D+'/protocol.json',{date:new Date().toISOString(),source:'2352b4b4913e48966f5240e92ce6da2f33f7a735',binary:hash(BIN),baselineBinary:hash(ROOT+'/build/shogi-lab-v0.19'),model:hash(ASSETS+'/yaneuraou.data'),policy:hash(ROOT+'/models/v0.17/all-policy.txt'),variants,devMs:300,devRoots:roots.length,testMs:[1000,3000],testSeeds:[20301,20302,20303,20304,20305,20306],testPlies:[20,36,52,68],teacherDepth:12,selection:'Lowest mean cp common-candidate gap among base/continuation/correction/scale75/scale125/see0/see90/see180/seecont; tie fewer incomplete roots, then listed order. Inference speed selection separately on same-node serial repeats. Test base, winner, combo. Never select from test.',notes:['Development roots are previously used positions.','New seeds are held out from this tuning only; complete training disjointness is not claimed.','SEE is heuristic and does not bound positional evaluation.','Static NNUE cache verifies complete snapshots, never caches repetition or search values.','Correction disables value TT; hash move hints remain.','No fixed depth or top-k; 95-ply emergency stop retained.']});
  console.log('frozen');return;
 }
 if(mode==='verify'){
  const roots=read(D+'/dev-roots.json').filter((_,i)=>i%4===0),rows=[];
  for(const root of roots){
   const baseline=await run(root,'base',0,20000,ROOT+'/build/shogi-lab-v0.19');
   for(const name of ['base','cache','fused','fast','fast-verify']){
    const a=await run(root,name,0,20000);same(a,baseline);rows.push({id:root.id,variant:name,nodes:a.nodes,stats:a.stats});
   }
  }
  const sfens=read(D+'/dev-roots.json').map(r=>r.sfen);
  save(D+'/verification.json',{passed:true,searchComparisons:rows.length,rows});console.log('verified '+rows.length);return;
 }
 if(mode==='speed'){
  const roots=read(D+'/dev-roots.json').filter((_,i)=>i%4===0),rows=[];
  for(let rep=0;rep<3;rep++)for(let i=0;i<roots.length;i++){
   const names=['base','cache','fused','fast'];
   for(let j=0;j<names.length;j++){
    const name=names[(i+rep+j)%names.length],a=await run(roots[i],name,0,150000);
    rows.push({id:roots[i].id,rep,variant:name,ms:a.elapsed_ms,nodes:a.nodes,score:a.score,pv:a.pv,stats:a.stats});
   }
  }save(D+'/speed.json',{rows});console.log('speed '+rows.length);return;
 }
 if(mode==='dev'||mode==='test'){
  const roots=read(D+'/'+mode+'-roots.json'),names=mode==='dev'?variants:read(D+'/protocol-amendment.json').testVariants,budgets=mode==='dev'?[300]:read(D+'/protocol.json').testMs;
  for(let i=0;i<roots.length;i++)for(const ms of budgets){
   const root=roots[i],path=D+'/'+mode+'/'+root.id+'-'+ms+'.json';if(existsSync(path))continue;
   const runs=[];for(let j=0;j<names.length;j++)runs.push(await run(root,names[(i+j)%names.length],ms));
   save(path,{root,ms,runs});console.log(JSON.stringify({mode,id:root.id,ms,depths:runs.map(r=>[r.variant,r.completed_depth])}));
  }return;
 }
 if(mode==='score-dev'||mode==='score-test'){await scoring(mode.slice(6));return;}
 if(mode==='select'){
  const totals=Object.fromEntries(variants.map(v=>[v,{gap:0,n:0,incomplete:0}]));
  for(const root of read(D+'/dev-roots.json')){
   const cs=read(D+'/dev-teacher/'+root.id+'.json').candidates,runs=read(D+'/dev/'+root.id+'-300.json').runs;
   for(const r of runs)totals[r.variant].incomplete+=!r.has_result;
   if(cs.some(c=>c.type!=='cp'||Math.abs(c.score)>=30000))continue;
   const scores=Object.fromEntries(cs.map(c=>[c.move,c.score])),best=Math.max(...Object.values(scores));
   for(const r of runs){totals[r.variant].gap+=best-scores[r.chosenMove];totals[r.variant].n++;}
  }for(const t of Object.values(totals)){if(!t.n)throw Error('No cp roots');t.meanGap=t.gap/t.n;}
  const eligible=['base','continuation','correction','scale75','scale125','see0','see90','see180','seecont'];
  const selected=eligible.sort((a,b)=>totals[a].meanGap-totals[b].meanGap||totals[a].incomplete-totals[b].incomplete)[0];
  const speed=read(D+'/speed.json').rows,med=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
  const times={};for(const name of ['base','cache','fused','fast'])times[name]=[...new Set(speed.map(x=>x.id))].reduce((s,id)=>s+med(speed.filter(x=>x.id===id&&x.variant===name).map(x=>x.ms)),0);
  const fastest=Object.keys(times).sort((a,b)=>times[a]-times[b])[0];
  // The combo's inference must be a tested exact mode; if base wins use original.
  save(D+'/selection.json',{selected,inference:fastest==='base'?'original':fastest,totals,times,at:new Date().toISOString()});console.log(JSON.stringify(read(D+'/selection.json')));return;
 }
 if(mode==='collect'){
  const p=read(D+'/protocol.json'),teacher=await yaneura(D+'/trajectory-usi.jsonl',{allLegalMoves:true}),roots=[];
  try{for(let game=0;game<p.testSeeds.length;game++){
   const path=D+'/trajectories/'+game+'.json';let rows;
   if(existsSync(path))rows=read(path).rows;
   else{
    let seed=p.testSeeds[game];const rng=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
    rows=[];const prefix=[];
    for(let ply=0;ply<=Math.max(...p.testPlies);ply++){
     const state=await lab(prefix,['--legal']);if(!state.moves.length||state.repetition_score!==null)break;
     await teacher.reset();const response=await teacher.search(prefix,{depth:8,multipv:3});
     const candidates=new Map();for(const x of response.infos)if(!x.bound&&x.depth>=8)candidates.set(x.rank,x);
     const first=candidates.get(1);if(!first)throw Error('No teacher PV');
     const pool=[...candidates.values()].filter(x=>x.type==='cp'&&first.type==='cp'&&first.score-x.score<=100);
     const move=ply<24&&pool.length?pool[Math.floor(rng()*pool.length)].pv[0]:response.move;
     if(!state.moves.includes(move))throw Error('Illegal teacher move');
     rows.push({prefix:[...prefix],sfen:state.sfen,move,response});prefix.push(move);
    }save(path,{seed:p.testSeeds[game],rows});console.log(JSON.stringify({trajectory:game,plies:rows.length}));
   }
   for(const i of p.testPlies)if(rows[i])roots.push({id:game+'-'+i,game,prefix:rows[i].prefix,sfen:rows[i].sfen});
  }}finally{teacher.close();}
  const key=s=>s.split(' ').slice(0,3).join(' '),known=new Set(read(D+'/dev-roots.json').map(r=>key(r.sfen))),seen=new Set();
  const unique=roots.filter(r=>{const k=key(r.sfen);if(seen.has(k)||known.has(k))return false;seen.add(k);return true;});
  save(D+'/test-roots.json',unique);console.log('new roots '+unique.length);return;
 }
 throw Error('Unknown mode');
}
if(process.argv[1]?.endsWith('experiment_v20.mjs'))await main();
