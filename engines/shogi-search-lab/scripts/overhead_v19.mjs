import {ROOT,START,lab,hash} from './arena_lib.mjs';
import {D,args,save,read} from './experiment_v19.mjs';
const rows=[],old=process.env.SHOGI_V18_BIN||ROOT+'/build/shogi-lab-v0.18';
for(const root of read(ROOT+'/results/v0.16/roots.json').slice(0,8))for(let repeat=0;repeat<3;repeat++){
 const results={};for(const name of ((root.id+repeat)%2?['old','off']:['off','old'])){
  results[name]=await lab(root.prefix,[...args('root'),'--max-nodes','200000'],START,name==='old'?old:undefined);
 }
 for(const key of ['score','pv','nodes','completed_depth','stop_reason','stats'])if(JSON.stringify(results.old[key])!==JSON.stringify(results.off[key]))throw Error('Baseline parity failure');
 rows.push({id:root.id,repeat,...results});
}
save(D+'/overhead.json',{referenceBinary:hash(old),rows});console.log(JSON.stringify({pairs:rows.length,passed:true}));
