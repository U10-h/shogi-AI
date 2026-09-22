import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,START,ASSETS,BIN,lab,hash} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
const D=ROOT+'/results/v0.17',rows=[];
const old=process.env.SHOGI_V16_BIN||ROOT+'/build/shogi-lab-v0.16';
for(const root of JSON.parse(readFileSync(D+'/dev-roots.json')).slice(0,4)){
 const a=['--advanced','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history','--depth','16','--iterative','--max-nodes','20000'];
 const reference=await lab(root.prefix,a,START,old),current=await lab(root.prefix,a);
 const exactKeys=['score','pv','nodes','completed_depth','stop_reason'];
 for(const key of exactKeys)if(JSON.stringify(reference[key])!==JSON.stringify(current[key]))throw Error('v0.16 regression '+key);
 rows.push({root:root.id,type:'baseline-parity',keys:exactKeys,reference,current});
 for(const mode of ['root','all']){
  const args=['--advanced','--eval','material','--features','tt,history,killer,counter','--driver','pvs','--depth','2','--max-nodes','2000000'];
  const base=await lab(root.prefix,args),ordered=await lab(root.prefix,[...args,'--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode',mode]);
  if(!base.complete||!ordered.complete||base.score!==ordered.score)throw Error('Policy alters complete minimax value');
  if(checkedPV(recordAt(START,root.prefix).position,ordered.pv).length!==ordered.pv.length)throw Error('Invalid PV');
  rows.push({root:root.id,type:'ordering-value-invariance',mode,score:base.score,baseNodes:base.nodes,policyNodes:ordered.nodes});
 }
}
writeFileSync(D+'/verification.json',JSON.stringify({binary:hash(BIN),referenceBinary:hash(old),rows},null,2)+'\n');console.log(JSON.stringify({checks:rows.length,passed:true}));
