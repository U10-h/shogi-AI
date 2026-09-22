// Small SPSA pilot on teacher move quality, not an Elo/self-play SPSA claim.
import {existsSync} from 'node:fs';
import {START,BIN,lab,yaneura} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
import {D,read,save,args} from './experiment_v20.mjs';
const suffix=process.env.SPSA_RUN||'',file=D+'/spsa'+suffix+'.json';
if(existsSync(file))throw Error('Tuning is one-shot; keep its full history');
const protocol={seed:202609220,steps:16,rootsPerStep:4,nodes:Number(process.env.SPSA_NODES||40000),teacherDepth:12,initial:[90,100],parameters:['qsee_margin','eval_scale'],bounds:[[0,300],[75,125]],c:[45,12],a:[300,20],alpha:.602,gamma:.101,A:4,maxStep:[20,5],loss:'negative teacher cp of chosen move, paired common candidates at each root; mate-containing pairs excluded',selection:'Use final theta, never choose best iteration. Holdout remains unseen.'};
save(D+'/spsa'+suffix+'-protocol.json',protocol);
let seed=protocol.seed,theta=[...protocol.initial];
const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const roots=read(D+'/dev-roots.json'),steps=[],teacher=await yaneura(D+'/spsa'+suffix+'-usi.jsonl',{allLegalMoves:true});
try{for(let k=0;k<protocol.steps;k++){
 const delta=theta.map(()=>rand()<.5?-1:1),c=protocol.c.map(x=>x/Math.pow(k+1,protocol.gamma));
 const plus=theta.map((x,j)=>Math.round(clamp(x+c[j]*delta[j],...protocol.bounds[j]))),minus=theta.map((x,j)=>Math.round(clamp(x-c[j]*delta[j],...protocol.bounds[j])));
 const rows=[];
 for(let z=0;z<protocol.rootsPerStep;z++){
  const root=roots[(k*protocol.rootsPerStep+z)%roots.length],runs=[];
  for(const [name,params] of (k%2?[['minus',minus],['plus',plus]]:[['plus',plus],['minus',minus]])){
   const a=await lab(root.prefix,[...args('see90'),'--qsee-margin',String(params[0]),'--eval-scale',String(params[1]),'--max-nodes',String(protocol.nodes)],START,BIN);
   const pv=a.has_result?a.pv:a.fallback_pv;if(!pv.length||checkedPV(recordAt(START,root.prefix).position,pv).length!==pv.length)throw Error('Invalid tuning PV');
   runs.push({name,params,analysis:a,move:pv[0]});
  }
  const moves=[...new Set(runs.map(r=>r.move))];
  await teacher.reset();const response=await teacher.search(root.prefix,{depth:protocol.teacherDepth,multipv:moves.length,searchmoves:moves});
  const cs=new Map();for(const x of response.infos)if(!x.bound&&x.depth>=protocol.teacherDepth&&moves.includes(x.pv[0]))cs.set(x.pv[0],x);
  if(cs.size!==moves.length)throw Error('Incomplete tuning teacher');
  const cp=[...cs.values()].every(x=>x.type==='cp'&&Math.abs(x.score)<30000);
  const lossDifference=cp?cs.get(runs.find(r=>r.name==='minus').move).score-cs.get(runs.find(r=>r.name==='plus').move).score:null;
  rows.push({root,runs,response,lossDifference});
 }
 const usable=rows.filter(r=>r.lossDifference!==null),difference=usable.reduce((s,r)=>s+r.lossDifference,0)/(usable.length||1);
 // Account for actual projected/rounded separation at parameter bounds.
 const gradient=theta.map((_,j)=>plus[j]===minus[j]?0:difference/(plus[j]-minus[j]));
 const before=[...theta];theta=theta.map((x,j)=>clamp(x-clamp(protocol.a[j]/Math.pow(k+protocol.A,protocol.alpha)*gradient[j],-protocol.maxStep[j],protocol.maxStep[j]),...protocol.bounds[j]));
 steps.push({k,before,delta,c,plus,minus,gradient,difference,theta:[...theta],rows});save(file,{protocol,steps,final:theta.map(Math.round),complete:k+1===protocol.steps});
 console.log(JSON.stringify({k,difference,theta}));
}}finally{teacher.close();}
