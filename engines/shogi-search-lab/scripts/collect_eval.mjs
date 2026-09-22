// Generate game-separated teacher labels. The protocol is written before searches.
import {writeFileSync,readFileSync} from 'node:fs';
import {ROOT,START,yaneura,hash,ASSETS} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove} from './record_helpers.mjs';
const groups=[
 ['train-0','train','7g7f 3c3d'],['train-1','train','2g2f 8c8d'],
 ['train-2','train','7g7f 8c8d'],['train-3','train','2g2f 3c3d'],
 ['train-4','train','5g5f 3c3d 2h5h 8c8d'],['train-5','train','7g7f 3c3d 2h6h 8c8d'],
 ['validation-0','validation','7g7f 8c8d 6g6f 3c3d'],
 ['validation-1','validation','2g2f 8c8d 2f2e 8d8e'],
 ['test-0','test','7g7f 3c3d 8h2b+ 3a2b'],
 ['test-1','test','2g2f 3c3d 7g7f 8c8d'],
 ['test-2','test','7g7f 3c3d 6g6f 8c8d 2h7h'],
 ['test-3','test','5g5f 8c8d 2h5h 3c3d']
].map(([id,split,opening])=>({id,split,opening:opening.split(' ')}));
const protocol={schema:1,groups,pliesPerGroup:40,teacherDepth:8,multipv:3,
 seed:20260921,selection:'Choose top 3 with fixed PRNG if within 180 cp; otherwise best. Labels use full PV endpoints. Test roots at offsets 4,12,20,28.',
 fit:'Fixed material + 38 positional features. Ridge around manual prior; lambda in [10,100,1000], chosen on validation MAE only. Exclude train/validation endpoint duplicates with later splits.',
 comparison:'Freeze final weights before test; tactical search unchanged; material, manual and learned; 16 unseen roots, 3000 ms, depth 3 also. Teacher depth 12 MultiPV over union. No timing concurrency.',
 match:'Final candidate vs material: 4 test openings, colors swapped, 300 ms per move, 200 ply cap. Candidate and material vs YaneuraOu: test-0 opening colors swapped, 3000 ms each, 160 ply cap. No Elo inference.'};
const dir=ROOT+'/results/v0.7';writeFileSync(dir+'/protocol.json',JSON.stringify(protocol,null,2));
let seed=protocol.seed;function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
const out={protocol,status:'running',opponent:{wasm:hash(ASSETS+'/yaneuraou.wasm'),data:hash(ASSETS+'/yaneuraou.data')},games:[]};
const save=()=>writeFileSync(dir+'/training-games.json',JSON.stringify(out,null,2));
const teacher=await yaneura(dir+'/training-protocol.jsonl');
try{for(const group of groups){
 const moves=[...group.opening],record=recordAt(START,moves),game={...group,rows:[]};out.games.push(game);await teacher.reset();
 for(let offset=0;offset<40;offset++){
  if(!hasLegalMove(record.position)||record.repetition)break;
  const a=await teacher.search(moves,{depth:8,multipv:3});
  const ranks=new Map();for(const i of a.infos)if(i.depth===8&&!i.bound)ranks.set(i.rank,i);
  const candidates=[...ranks.values()].sort((a,b)=>a.rank-b.rank);
  if(!candidates.length)break;
  const labels=candidates.filter(c=>c.type==='cp'&&Math.abs(c.score)<5000).map(c=>{
   if(checkedPV(record.position,c.pv).length!==c.pv.length)throw Error('Invalid teacher PV');
   const leaf=recordAt(START,[...moves,...c.pv]);
   return {...c,leafSfen:leaf.position.sfen,blackScore:c.score*(record.position.color==='black'?1:-1)};
  });
  const eligible=candidates.filter(c=>c.type==='cp'&&c.score>=candidates[0].score-180);
  const selected=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
  game.rows.push({offset,prefix:[...moves],sfen:record.position.sfen,candidates:labels,selected});
  const m=record.position.createMoveByUSI(selected);if(!m||!record.append(m))throw Error('Invalid move');moves.push(selected);
  if(offset%10===0){save();console.log(JSON.stringify({group:group.id,offset,labels:labels.length}));}
 }
 save();
}out.status='finished';save();}finally{teacher.close();}
