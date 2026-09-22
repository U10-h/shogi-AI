// Fixed-depth teacher collection. Independent process shards; never time benchmarks.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,hash,yaneura} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove} from './record_helpers.mjs';
const shard=Number(process.argv[2]||0),shards=Number(process.argv[3]||4);
const dir=ROOT+'/results/v0.10',protocol=JSON.parse(readFileSync(dir+'/protocol.json'));
if(hash(ASSETS+'/yaneuraou.data')!==protocol.modelSha256)throw Error('Model hash mismatch');
mkdirSync(dir+'/games',{recursive:true});
mkdirSync(dir+'/games-final',{recursive:true});
const openings=[
 '7g7f 3c3d','2g2f 8c8d','7g7f 8c8d','2g2f 3c3d',
 '5g5f 3c3d 2h5h 8c8d','7g7f 3c3d 2h6h 8c8d',
 '7g7f 8c8d 6g6f 3c3d','2g2f 8c8d 2f2e 8d8e',
 '7g7f 3c3d 8h2b+ 3a2b','2g2f 3c3d 7g7f 8c8d',
 '7g7f 3c3d 6g6f 8c8d 2h7h','5g5f 8c8d 2h5h 3c3d',
 '9g9f 3c3d 7g7f 8c8d','7g7f 3c3d 2h4h 8c8d',
 '7g7f 3c3d 9g9f 9c9d 6g6f 4c4d','2g2f 4c4d 7g7f 3c3d'
].map(s=>s.split(' '));
for(const o of openings)recordAt(START,o);
const teacher=await yaneura();
try {for(let id=shard;id<protocol.data.games;id+=shards) {
 const path=dir+'/games/'+String(id).padStart(3,'0')+'.json';
 const finalPath=dir+'/games-final/'+String(id).padStart(3,'0')+'.json';
 if(existsSync(finalPath)&&JSON.parse(readFileSync(finalPath)).status==='finished')continue;
 if(existsSync(path)&&JSON.parse(readFileSync(path)).status==='finished'){writeFileSync(finalPath,readFileSync(path));continue;}
 let seed=(protocol.seed+id*7919)>>>0;
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
 const opening=openings[id%openings.length],moves=[...opening],record=recordAt(START,moves);
 const game={id,split:id<128?'train':id<160?'validation':'test',seed,opening,status:'running',rows:[],terminal:null,teacherName:teacher.name};
 const save=()=>{writeFileSync(path+'.tmp',JSON.stringify(game));renameSync(path+'.tmp',path);};
 await teacher.reset();
 for(let offset=0;offset<protocol.data.maxPlies;offset++) {
  if(record.repetition){game.terminal={reason:'repetition',checker:record.perpetualCheck};break;}
  if(!hasLegalMove(record.position)){game.terminal={reason:'no-legal-move',loser:record.position.color};break;}
  const a=await teacher.search(moves,{depth:protocol.data.teacherDepth,multipv:protocol.data.multiPV});
  const ranks=new Map();for(const i of a.infos)if(!i.bound)ranks.set(i.rank,i);
  const candidates=[...ranks.values()].sort((a,b)=>a.rank-b.rank);
  if(!candidates.length)throw Error('No candidate at game '+id+' ply '+offset);
  const labels=[];
  for(const c of candidates) {
   if(checkedPV(record.position,c.pv).length!==c.pv.length)throw Error('Illegal teacher PV');
   const child=recordAt(START,[...moves,c.pv[0]]);
   labels.push({...c,childSfen:child.position.sfen,childChecked:child.position.checked});
  }
  const eligible=candidates.filter(c=>c.type==='cp'&&c.score>=candidates[0].score-(offset<12?240:180));
  const move=eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
  game.rows.push({offset,ply:moves.length,sfen:record.position.sfen,checked:record.position.checked,candidates:labels,selected:move});
  const m=record.position.createMoveByUSI(move);
  if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Illegal teacher selection');
  moves.push(move);
  if(offset%20===19){save();console.log(JSON.stringify({shard,game:id,split:game.split,plies:offset+1}));}
 }
 game.status='finished';game.finalSfen=record.position.sfen;game.randomState=seed;save();writeFileSync(finalPath,JSON.stringify(game));
 console.log(JSON.stringify({shard,game:id,finished:true,rows:game.rows.length,terminal:game.terminal}));
}}finally{teacher.close();}
