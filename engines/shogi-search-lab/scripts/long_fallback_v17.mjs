import {readFileSync,existsSync} from 'node:fs';
import {ROOT} from './arena_lib.mjs';
import {D,run,save} from './experiment_v17.mjs';
const roots=JSON.parse(readFileSync(ROOT+'/results/v0.16/fallback-replay.json')).rows.filter(x=>x.variant==='baseline');
const path=D+'/long-fallback.json',rows=existsSync(path)?JSON.parse(readFileSync(path)).rows:[];
for(const root of roots)for(const ms of [5000,10000])for(const name of ['adaptive','root']){
 if(rows.some(r=>r.ply===root.ply&&r.ms===ms&&r.name===name))continue;
 const analysis=await run(root.prefix,name,ms);rows.push({ply:root.ply,prefix:root.prefix,ms,name,analysis});
 save(path,{selection:'Post-hoc known v0.16 difficult positions; time scaling diagnostic, not independent strength test',rows});
 console.log(JSON.stringify({ply:root.ply,ms,name,completed:analysis.has_result,pv:analysis.pv.length,depth:analysis.stats.selective_depth}));
}
