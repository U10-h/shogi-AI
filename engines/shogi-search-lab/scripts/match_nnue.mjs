import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,BIN,START,ASSETS,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.8',model=ASSETS+'/yaneuraou.data';
const protocol=JSON.parse(readFileSync(dir+'/protocol.json'));
if(hash(model)!==protocol.modelSha256)throw Error('Frozen model changed');
const plans=[];
for(const [index,opening] of protocol.openings.slice(0,2).entries())for(const side of ['black','white'])plans.push({id:'self-'+index+'-'+side,opening,candidateSide:side,opponent:'positional',candidate:'nnue',ms:300,maxPlies:200});
for(const side of ['black','white'])plans.push({id:'yaneura-nnue-'+side,opening:protocol.openings[0],candidateSide:side,opponent:'yaneuraou',candidate:'nnue',ms:3000,maxPlies:160});
const result={schema:1,status:'running',binarySha256:hash(BIN),modelSha256:hash(model),protocolSha256:hash(dir+'/protocol.json'),plans,settings:{ponder:false,book:false,preset:'tactical',threads:1,multiPV:1,reuseBetweenMoves:false},games:[]};
writeFileSync(dir+'/match-protocol.json',JSON.stringify({...result,games:undefined},null,2));
const save=()=>writeFileSync(dir+'/matches.json',JSON.stringify(result,null,2));
const teacher=await yaneura(dir+'/match-opponent-protocol.jsonl');
const other=c=>c==='black'?'white':'black';
try{for(const p of plans){
 const game={...p,initial:START,moves:[],status:'running',result:null};result.games.push(game);save();
 const record=recordAt(START,p.opening),initialAfterOpening=record.position.sfen;
 await teacher.reset();
 for(let ply=0;ply<=p.maxPlies;ply++){
  const prefix=[...p.opening,...game.moves.map(m=>m.usi)],state=await lab(prefix,['--legal']);
  const side=record.position.color,isCandidate=side===p.candidateSide;
  if(state.repetition_score!==null){game.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?side:other(side)};break;}
  if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Independent terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(side)};break;}
  if(ply===p.maxPlies)break;
  const variant=isCandidate?p.candidate:p.opponent;
  let analysis,move,wallMs;
  if(variant==='yaneuraou'){
   const a=await teacher.search(prefix,{ms:p.ms});move=a.move;wallMs=a.wallMs;analysis=a.info;
   if(move==='resign'){game.result={reason:'resign',winner:other(side)};break;}
  }else{
   const args=['--advanced','--preset','tactical','--eval',variant,'--depth','16','--iterative','--time-ms',String(p.ms),'--max-nodes','1000000000'];
   if(variant==='nnue')args.push('--eval-model',model);
   const start=performance.now();analysis=await lab(prefix,args);wallMs=performance.now()-start;move=analysis.bestmove;
  }
  if(!state.moves.includes(move))throw Error('Illegal move '+move);
  if(analysis?.pv&&checkedPV(record.position,analysis.pv).length!==analysis.pv.length)throw Error('Illegal PV');
  const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Independent illegal move');
  game.moves.push({ply:prefix.length+1,side,variant,usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,analysis,wallMs});save();
  if(ply%10===0)console.log(JSON.stringify({game:game.id,ply:prefix.length+1,move,variant}));
 }
 if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};
 game.status='finished';save();
 const kif=exportGame({initial:initialAfterOpening,moves:game.moves.map(m=>m.usi),result:JSON.stringify(game.result)});
 if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(game.moves.map(m=>m.usi)))throw Error('KIF mismatch');
 writeFileSync(dir+'/'+game.id+'.kif',kif);
 console.log(JSON.stringify({game:game.id,plies:game.moves.length,result:game.result}));
}result.status='finished';save();}catch(e){result.status='error';result.error=e.stack;save();throw e;}finally{teacher.close();}
