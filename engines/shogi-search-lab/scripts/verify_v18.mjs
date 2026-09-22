import {ROOT,START,lab,hash} from './arena_lib.mjs';
import {D,args,save,read} from './experiment_v18.mjs';
const roots=read(ROOT+'/results/v0.16/roots.json').slice(0,8),rows=[];
const old=process.env.SHOGI_V17_BIN||ROOT+'/build/shogi-lab-v0.17';
for(const root of roots){
 const options=[...args('root'),'--max-nodes','20000'];
 const expected=await lab(root.prefix,options,START,old),actual=await lab(root.prefix,options);
 for(const key of ['score','pv','nodes','completed_depth','stop_reason','fallback_pv','stats'])if(JSON.stringify(expected[key])!==JSON.stringify(actual[key]))throw Error('Disabled regression '+root.id+' '+key);
 const cached=await lab(root.prefix,[...args('cache'),'--max-nodes','200000']);
 if(expected.iterations.length&&cached.iterations.length&&expected.iterations[0].score!==cached.iterations[0].score)throw Error('First qtree mismatch');
 rows.push({id:root.id,expected,actual,cached});
}
save(D+'/verification.json',{passed:true,baselineComparisons:rows.length,referenceBinary:hash(old),rows});console.log(JSON.stringify({passed:true,rows:rows.length}));
