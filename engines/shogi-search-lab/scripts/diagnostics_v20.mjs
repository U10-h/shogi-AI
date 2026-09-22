import {D,read,save,run,args} from './experiment_v20.mjs';
import {ROOT,START,BIN,lab} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
import {existsSync} from 'node:fs';
const roots=read(D+'/dev-roots.json').filter((_,i)=>i%4===0);
if(!existsSync(D+'/speed-v19.json')){
 const rows=[];
 for(let rep=0;rep<3;rep++)for(let i=0;i<roots.length;i++)for(let j=0;j<3;j++){
  const name=['v19','base','cache'][(rep+i+j)%3],a=await run(roots[i],name==='v19'?'base':name,0,150000,name==='v19'?ROOT+'/build/shogi-lab-v0.19':BIN);
  rows.push({id:roots[i].id,rep,variant:name,ms:a.elapsed_ms,nodes:a.nodes,score:a.score,pv:a.pv,stats:a.stats});
 }save(D+'/speed-v19.json',{rows});
}
if(!existsSync(D+'/hard.json')){
 const rows=[];
 for(const root of read(D+'/hard-roots.json'))for(const name of ['base','combo','see0','see90','spsa'])rows.push({root,analysis:await run(root,name,1000)});
 save(D+'/hard.json',{selection:'Six historical first-iteration failures from a single v0.16 loss; diagnostic, not independent holdout.',ms:1000,rows});
}
if(!existsSync(D+'/qsee-audit.json')){
 const rows=[];
 for(const root of roots)for(const name of ['see0','see90','see180']){
  const a=await lab(root.prefix,[...args(name),'--qsee-audit','--max-nodes','200000'],START);
  const pv=a.has_result?a.pv:a.fallback_pv;if(!pv.length||checkedPV(recordAt(START,root.prefix).position,pv).length!==pv.length)throw Error('Invalid audit PV');
  rows.push({root,name,analysis:a});
 }save(D+'/qsee-audit.json',{nodesPerRun:200000,notes:'Counterfactual unpruned qsearch of each skipped branch. Audit nodes count against budget. Incomplete audits cannot certify safety. Only detects a local alpha improvement, not global move error.',rows});
}
