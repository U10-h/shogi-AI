// Four color-swapped games, fixed openings and equal per-move time.
import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,BIN,START,ASSETS,lab,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.9',old=ROOT+'/build/shogi-lab-v0.8',model=ASSETS+'/yaneuraou.data';
const protocol=JSON.parse(readFileSync(dir+'/protocol.json'));
if(hash(model)!==protocol.modelSha256)throw Error('Frozen model mismatch');
const openings=JSON.parse(readFileSync(ROOT+'/results/v0.8/protocol.json')).openings.slice(0,2);
const plans=[];for(const [index,opening] of openings.entries())for(const side of ['black','white'])plans.push({id:'core-'+index+'-'+side,opening,candidateSide:side,ms:150,maxPlies:200});
const result={status:'running',plans,binaries:{old:hash(old),final:hash(BIN)},modelSha256:hash(model),protocolSha256:hash(dir+'/protocol.json'),games:[]};
if(process.argv.includes('--resume')) {
 const saved=JSON.parse(readFileSync(dir+'/matches.json'));
 if(JSON.stringify(saved.binaries)!==JSON.stringify(result.binaries)||JSON.stringify(saved.plans)!==JSON.stringify(plans))throw Error('Resume configuration changed');
 result.games=saved.games;result.resumed=true;
}
result.fallbackPolicy='If no iteration completes, use first legal move, matching the existing USI adapter for both binaries. Analysis retains null bestmove.';
result.protocolAmendment='results/v0.9/match-fallback-amendment.json';
const save=()=>writeFileSync(dir+'/matches.json',JSON.stringify(result,null,2));
const other=c=>c==='black'?'white':'black';
try {for(const p of plans) {
 let game=result.games.find(g=>g.id===p.id);
 if(game?.status==='finished')continue;
 if(!game){game={...p,status:'running',moves:[],result:null};result.games.push(game);}save();
 const initialAfterOpening=recordAt(START,p.opening).position.sfen;
 const record=recordAt(START,[...p.opening,...game.moves.map(m=>m.usi)]);
 for(let ply=game.moves.length;ply<=p.maxPlies;ply++) {
  const prefix=[...p.opening,...game.moves.map(m=>m.usi)],state=await lab(prefix,['--legal']);
  const side=record.position.color;
  if(state.repetition_score!==null) {
   if(!record.repetition)throw Error('Independent repetition mismatch');
   const checker=record.perpetualCheck;
   const expected=checker===null?0:checker===side?-100000:100000;
   if(state.repetition_score!==expected)throw Error('Independent perpetual-check mismatch');
   game.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?side:other(side)};break;
  }
  if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Independent terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(side)};break;}
  if(ply===p.maxPlies)break;
  const variant=side===p.candidateSide?'final':'old';
  const args=['--advanced','--preset','tactical','--eval','nnue','--eval-model',model,'--depth','16','--iterative','--time-ms',String(p.ms),'--max-nodes','1000000000'];
  const begin=performance.now(),analysis=await lab(prefix,args,START,variant==='old'?old:BIN),wallMs=performance.now()-begin;
  let move=analysis.bestmove;const fallback=!analysis.has_result;
  if(fallback){if(analysis.pv.length)throw Error('Unexpected PV without completed iteration');move=state.moves[0];}
  if(!state.moves.includes(move)||checkedPV(record.position,analysis.pv).length!==analysis.pv.length)throw Error('Illegal move/PV');
  const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Independent illegal move');
  game.moves.push({ply:prefix.length+1,side,variant,usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,analysis,wallMs,...(fallback?{fallback:'no-completed-iteration'}:{})});save();
  if(ply%20===0)console.log(JSON.stringify({game:p.id,ply:prefix.length+1,move,variant}));
 }
 if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};
 game.status='finished';save();
 const kif=exportGame({initial:initialAfterOpening,moves:game.moves.map(m=>m.usi),result:JSON.stringify(game.result)});
 if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(game.moves.map(m=>m.usi)))throw Error('KIF mismatch');
 writeFileSync(dir+'/'+game.id+'.kif',kif);
 console.log(JSON.stringify({game:game.id,plies:game.moves.length,result:game.result}));
}result.status='finished';save();}catch(e){result.status='error';result.error=e.stack;save();throw e;}
