import {readFileSync,writeFileSync,appendFileSync,mkdirSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {ROOT,BIN,ASSETS,START,hash,lab,yaneura} from './arena_lib.mjs';

const out=resolve(process.env.MATCH_OUTPUT||ROOT+'/results/v0.6/matches.json');
const dir=resolve(out,'..');mkdirSync(dir,{recursive:true});
const transcript=dir+'/opponent-protocol.jsonl';writeFileSync(transcript,'');
const budget=Number(process.env.MATCH_MS||3000);
const plans=[{id:'tactical-black',preset:'tactical',labSide:'black'},
 {id:'selective-white',preset:'selective',labSide:'white'},
 {id:'tactical-white',preset:'tactical',labSide:'white'},
 {id:'selective-black',preset:'selective',labSide:'black'}];
const result={schema:1,recordedAt:new Date().toISOString(),status:'running',settings:{timeMs:budget,ponder:false,opening:'平手・初期局面',maxPlies:256,enteringKing:false,
 lab:{version:'0.5',binarySha256:hash(BIN),threads:1,multiPV:1,maxDepth:16,maxNodes:1000000000,reuseBetweenMoves:false},
 opponent:{version:'6.03',variant:'NNUE KP256 / WASM 0.1.2',evaluation:'2019-01-15 KP256',wasmSha256:hash(ASSETS+'/yaneuraou.wasm'),evaluationSha256:hash(ASSETS+'/yaneuraou.data')}},plans,games:[]};
writeFileSync(dir+'/frozen-protocol.json',JSON.stringify({...result,games:undefined},null,2));
const save=()=>{writeFileSync(out+'.tmp',JSON.stringify(result,null,2));renameSync(out+'.tmp',out);};
const other=c=>c==='black'?'white':'black';
let opponent;
try{
 opponent=await yaneura(transcript);result.settings.opponent.name=opponent.name;result.settings.opponent.options=opponent.options;
 for(const plan of plans){
  await opponent.reset();const game={...plan,labVersion:'0.5',initial:START,startedAt:new Date().toISOString(),moves:[],status:'running',result:null};result.games.push(game);save();
  for(let ply=0;ply<result.settings.maxPlies;ply++){
   const moves=game.moves.map(m=>m.usi),state=await lab(moves,['--legal']);const side=state.sfen.split(' ')[1]==='b'?'black':'white';
   if(state.repetition_score!==null){game.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?side:other(side)};break;}
   if(!state.moves.length){game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(side)};break;}
   let move,analysis,wallMs;const isLab=side===game.labSide;
   if(isLab){
    const args=['--advanced','--preset',plan.preset,'--depth','16','--iterative','--time-ms',String(budget),'--max-nodes','1000000000'];
    const begin=performance.now(),a=await lab(moves,args);wallMs=performance.now()-begin;move=a.bestmove;
    if(!move)throw Error('No completed lab iteration');
    analysis={...a,depth:a.completed_depth,type:Math.abs(a.score)>90000?'lab-mate':'cp',engineMs:a.elapsed_ms,candidates:a.candidates.map((c,i)=>({...c,rank:i+1,move:c.pv[0],depth:a.completed_depth}))};
   }else{
    const a=await opponent.search(moves,{ms:budget});move=a.move;wallMs=a.wallMs;
    if(move==='resign'){game.result={reason:'resign',winner:game.labSide};break;}
    if(move==='win')throw Error('Opponent entering-king claim disabled');
    const i=a.info;analysis=i?{...i,engineMs:i.time,candidates:[{rank:1,move,score:i.score,depth:i.depth,pv:i.pv}]}:null;
   }
   if(!state.moves.includes(move))throw Error('Illegal '+(isLab?'lab':'opponent')+' move '+move);
   const next=await lab([...moves,move],['--legal']);
   const row={ply:ply+1,side,engine:isLab?'lab':'yaneuraou',usi:move,label:move,beforeSfen:state.sfen,afterSfen:next.sfen,check:next.in_check,materialBefore:state.material_score,wallMs,analysis};game.moves.push(row);save();
   console.log(JSON.stringify({game:plan.id,ply:row.ply,engine:row.engine,move,ms:Math.round(wallMs),depth:analysis?.depth,score:analysis?.score,type:analysis?.type,check:row.check}));
  }
  if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};
  game.status='finished';game.finishedAt=new Date().toISOString();save();
  writeFileSync(dir+'/'+game.id+'.usi','position startpos moves '+game.moves.map(m=>m.usi).join(' ')+'\n');
  console.log(JSON.stringify({game:game.id,result:game.result,plies:game.moves.length}));
 }
 result.status='finished';result.finishedAt=new Date().toISOString();save();
}catch(e){result.status='error';result.error=e.stack;save();throw e;}finally{opponent?.close();}
