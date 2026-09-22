import {ROOT,START,lab,hash} from './arena_lib.mjs';
import {D,args,save,read} from './experiment_v19.mjs';
import {checkedPV,recordAt} from './record_helpers.mjs';
const old=ROOT+'/build/shogi-lab-v0.18',rows=[];
for(const root of read(D+'/dev-roots.json').slice(0,8)){
 const expected=await lab(root.prefix,[...args('root'),'--max-nodes','200000'],START,old);
 const oldCache=await lab(root.prefix,[...args('root'),'--features','tt,history,killer,counter,mate-distance,qsearch,capture-history,qcache','--max-nodes','200000'],START,old);
 const variants=[];
 for(const name of ['root','legacy','all8','all32','entry1','entry8']){
  const actual=await lab(root.prefix,[...args(name),'--max-nodes','200000']);
  if(name==='root'||name==='legacy'){
   const ref=name==='root'?expected:oldCache;
   for(const key of ['score','pv','nodes','completed_depth','stop_reason','fallback_pv'])if(JSON.stringify(ref[key])!==JSON.stringify(actual[key]))throw Error('Legacy parity '+root.id+' '+name+' '+key);
   for(const [key,value] of Object.entries(ref.stats))if(actual.stats[key]!==value)throw Error('Stats parity '+name+' '+key);
  }
  if(expected.iterations.length&&actual.iterations.length&&expected.iterations[0].score!==actual.iterations[0].score)throw Error('First-tree mismatch '+name);
  for(const iteration of actual.iterations)checkedPV(recordAt(START,root.prefix).position,iteration.pv);
  variants.push({name,actual});
 }
 rows.push({root,expected,oldCache,variants});save(D+'/verification.json',{passed:true,referenceBinary:hash(old),rows});
}
console.log(JSON.stringify({passed:true,roots:rows.length,comparisons:rows.length*6}));
