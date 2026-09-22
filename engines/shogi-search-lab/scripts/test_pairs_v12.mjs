// Derive held-out child SFENs independently after all model weights are frozen.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {ROOT} from './arena_lib.mjs';
import {recordAt} from './record_helpers.mjs';
const D=ROOT+'/results/v0.12',rows=[];
for(const file of readdirSync(D+'/games').filter(p=>p.endsWith('.json')).sort()){
 const g=JSON.parse(readFileSync(D+'/games/'+file));
 for(const row of g.rows){
  if(row.ply<12)continue;
  const candidates=[];
  for(const c of row.candidates){
   if(c.type!=='cp'||Math.abs(c.score)>=8000)continue;
   const p=recordAt(row.sfen,[c.pv[0]]).position;
   if(!p.checked)candidates.push({sfen:p.sfen,raw:-c.score*.9,rank:c.rank,move:c.pv[0]});
  }
  if(candidates.length>=2)rows.push({game:g.id,offset:row.offset,candidates});
 }
}
writeFileSync(D+'/test-pair-children.json',JSON.stringify(rows));console.log(JSON.stringify({rows:rows.length}));
