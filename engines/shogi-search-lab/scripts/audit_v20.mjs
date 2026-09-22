import {readdirSync} from 'node:fs';
import {D,read,save} from './experiment_v20.mjs';
const assert=(x,m)=>{if(!x)throw Error(m);};
const p=read(D+'/protocol.json'),am=read(D+'/protocol-amendment.json');
for(const part of ['dev','test']){
 const roots=read(D+'/'+part+'-roots.json'),budgets=part==='dev'?[300]:p.testMs,names=part==='dev'?p.variants:am.testVariants;
 assert(roots.length===(part==='dev'?32:24),'Root count');
 for(const root of roots){
  const t=read(D+'/'+part+'-teacher/'+root.id+'.json');
  const cs=new Set(t.candidates.map(c=>c.move));
  for(const ms of budgets){
   const x=read(D+'/'+part+'/'+root.id+'-'+ms+'.json');assert(x.runs.length===names.length,'Run count');
   assert(new Set(x.runs.map(r=>r.variant)).size===names.length,'Duplicate variants');
   for(const r of x.runs){assert(names.includes(r.variant),'Unknown variant');assert(cs.has(r.chosenMove),'Teacher missing move');assert(r.evaluation_model,'Missing model');assert(r.nodes<=1e9,'Node cap');}
  }
 }
}
for(const name of ['spsa','spsa-200k']){const x=read(D+'/'+name+'.json');assert(x.complete&&x.steps.length===16,'Incomplete SPSA');}
assert(read(D+'/verification.json').searchComparisons===40,'Verification count');
assert(read(D+'/amendment-verification.json').rows.length===16,'Amendment count');
const speed=read(D+'/speed-v19.json').rows;assert(speed.length===72,'Speed count');
for(const r of speed){const old=speed.find(x=>x.id===r.id&&x.variant==='v19');assert(r.nodes===old.nodes&&r.score===old.score&&JSON.stringify(r.pv)===JSON.stringify(old.pv),'150k-node exact cache parity');}
const games=[];
for(const side of am.matches.sides)for(const name of am.matches.variants){const g=read(D+'/matches/'+side+'-'+name+'.json');assert(g.status==='finished'&&g.result,'Unfinished game');games.push({id:g.id,plies:g.moves.length,resumptions:g.resumptions||[]});}
assert(read(D+'/qsee-audit.json').rows.length===24,'Audit count');
save(D+'/audit.json',{passed:true,at:new Date().toISOString(),devSearches:384,testSearches:240,spsaSearches:256,legacyParity20kComparisons:40,amendmentComparisons:16,additionalSameScorePvNodes150kRows:72,games,checks:'Required counts, teacher candidate coverage, variant uniqueness, frozen experiment results, 150k-node score/PV/node parity; independent PV legality and KIF round trips checked during generation.'});
console.log('v0.20 artifact audit passed');
