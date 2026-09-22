// Teacher games are split by entire game before generation. No time benchmarks here.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,lab,yaneura,hash,ASSETS} from './arena_lib.mjs';
import {recordAt,checkedPV,exportGame,parseRecord} from './record_helpers.mjs';
const D=ROOT+'/results/v0.17';mkdirSync(D+'/selfplay',{recursive:true});
const save=(p,x)=>{writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);};
const seeds=[[],['7g7f','3c3d'],['2g2f','8c8d'],['7g7f','8c8d'],['2g2f','3c3d'],['7g7f','3c3d','6g6f'],['7g7f','3c3d','2g2f','5c5d','2f2e','8b5b'],['7g7f','8c8d','2g2f','8d8e'],[],['7g7f','3c3d','6g6f','8c8d']];
const teacher=await yaneura(D+'/selfplay-usi.jsonl',{allLegalMoves:true});
save(D+'/teacher-settings.json',{name:teacher.name,options:teacher.options,handshake:teacher.handshake,wasm:hash(ASSETS+'/yaneuraou.wasm'),data:hash(ASSETS+'/yaneuraou.data'),depth:8,seed:2026092217});
try{for(let id=0;id<seeds.length;id++){
 const path=D+'/selfplay/'+id+'.json';if(existsSync(path)&&JSON.parse(readFileSync(path)).status==='finished')continue;
 const opening=seeds[id],split=id<6?'train':id<8?'validation':'test';
 const g={id,split,opening,rows:[],status:'running',result:null};let prefix=[...opening],rng=(2026092217+id*7919)>>>0;
 const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;};
 await teacher.reset();let record=recordAt(START,prefix);
 for(let k=0;k<160;k++){
  const state=await lab(prefix,['--legal']);
  if(state.repetition_score!==null||!state.moves.length){g.result={reason:state.repetition_score!==null?'repetition':'no-legal-move',repetition:state.repetition_score};break;}
  const a=await teacher.search(prefix,{depth:8,multipv:3}),ranks=new Map();
  for(const x of a.infos)if(!x.bound)ranks.set(x.rank,x);
  const cs=[...ranks.values()].sort((a,b)=>a.rank-b.rank);
  if(a.move==='resign'){g.result={reason:'resign'};break;}
  for(const c of cs)if(checkedPV(record.position,c.pv).length!==c.pv.length)throw Error('Illegal teacher PV');
  const eligible=cs.filter(c=>c.type==='cp'&&cs[0].type==='cp'&&c.score>=cs[0].score-100);
  const move=k<20&&eligible.length?eligible[Math.floor(random()*eligible.length)].pv[0]:a.move;
  g.rows.push({ply:prefix.length+1,prefix:[...prefix],sfen:state.sfen,checked:state.in_check,candidates:cs,move,analysis:a});
  if(!state.moves.includes(move))throw Error('Illegal teacher move');
  prefix.push(move);record=recordAt(START,prefix);save(path,g);
  if(k%40===0)console.log(JSON.stringify({id,split,ply:prefix.length,move}));
 }
 if(!g.result)g.result={reason:'move-limit',unresolved:true};g.status='finished';save(path,g);
 const kif=exportGame({initial:START,moves:prefix,result:JSON.stringify(g.result)});
 if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(prefix))throw Error('KIF mismatch');writeFileSync(D+'/selfplay/'+id+'.kif',kif);
 console.log(JSON.stringify({id,split,plies:prefix.length,result:g.result}));
}}finally{teacher.close();}
