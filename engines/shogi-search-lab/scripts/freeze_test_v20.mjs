import {D,read,save,run} from './experiment_v20.mjs';
import {BIN,hash,ROOT} from './arena_lib.mjs';
import {existsSync} from 'node:fs';
if(existsSync(D+'/test'))throw Error('Test already started');
save(D+'/protocol-amendment.json',{at:new Date().toISOString(),binary:hash(BIN),priorBinary:read(D+'/protocol.json').binary,reasons:['40000-node SPSA produced zero objective difference at every step; repeat once at 200000 nodes with the same development roots and schedule.','Add correction_gain=0 control, preserving correction learning and value-TT disabling, to isolate applied correction.','Keep original development-selected combo; no selection from holdout.'],testVariants:['base','winner','combo','correction0','spsa'],testMs:read(D+'/protocol.json').testMs,spsaFile:'spsa-200k.json',matches:{variants:['base','combo'],sides:['black','white'],ourMs:1000,opponentMs:1000,maxPlies:200,opening:[],terminal:'No evaluation adjudication; repetition, perpetual check, legal terminal, resignation, or unresolved move cap.'}});
const rows=[];
for(const root of read(D+'/dev-roots.json').filter((_,i)=>i%4===0))for(const name of ['base','correction']){
 const before=await run(root,name,0,100000,ROOT+'/build/shogi-lab-v20-screen'),after=await run(root,name,0,100000);
 for(const k of ['score','pv','nodes','completed_depth','stop_reason','has_result','fallback_pv'])if(JSON.stringify(before[k])!==JSON.stringify(after[k]))throw Error('Amendment changed default: '+k);
 rows.push({id:root.id,name,passed:true});
}
save(D+'/amendment-verification.json',{rows});
