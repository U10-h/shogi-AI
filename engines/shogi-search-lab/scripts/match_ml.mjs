// Fixed-node matches permit concurrent games without unequal time budgets.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {ROOT,START,BIN,ASSETS,lab,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const shard=Number(process.argv[2]||0),shards=Number(process.argv[3]||4),D=ROOT+'/results/v0.10';
const frozen=JSON.parse(readFileSync(D+'/frozen-model.json')),candidate=ROOT+'/build/models/v0.10/'+frozen.selected+'.nnue';
if(hash(candidate)!==frozen.modelSha256)throw Error('Frozen model changed');
const roots=JSON.parse(readFileSync(D+'/test-roots.json'));
// First root from 16 distinct held-out games, fixed before outcomes.
const starts=roots.filter((r,i)=>i%3===0).slice(0,16);if(starts.length!==16)throw Error('Not enough starts');
const plans=[];for(const [i,root] of starts.entries())for(const side of ['black','white'])plans.push({id:i+'-'+side,root,candidateSide:side,nodes:12000,maxPlies:200});
const dir=D+'/matches';mkdirSync(dir,{recursive:true});const other=c=>c==='black'?'white':'black';
for(let index=shard;index<plans.length;index+=shards) {
 const p=plans[index],path=dir+'/'+p.id+'.json';
 if(existsSync(path)){const done=JSON.parse(readFileSync(path));if(done.status==='finished'&&done.modelSha256===frozen.modelSha256)continue;throw Error('Incomplete or changed match');}
 const game={...p,index,status:'running',modelSha256:frozen.modelSha256,binarySha256:hash(BIN),initial:START,moves:[],result:null};
 const prefix=[...p.root.prefix],record=recordAt(START,prefix),initialAfterOpening=record.position.sfen;
 for(let ply=0;ply<=p.maxPlies;ply++) {
  const state=await lab(prefix,['--legal']),side=record.position.color;
  if(state.repetition_score!==null){
   if(!record.repetition)throw Error('Independent repetition mismatch');
   const checker=record.perpetualCheck,winner=checker===null?null:other(checker);
   if((state.repetition_score===0?null:state.repetition_score>0?side:other(side))!==winner)throw Error('Perpetual check mismatch');
   game.result={reason:checker===null?'repetition':'perpetual-check',winner};break;
  }
  if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Independent terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(side)};break;}
  if(ply===p.maxPlies)break;
  const variant=side===p.candidateSide?frozen.selected:'base',model=variant==='base'?ASSETS+'/yaneuraou.data':candidate;
  const analysis=await lab(prefix,['--advanced','--preset','tactical','--eval','nnue','--eval-model',model,'--depth','16','--iterative','--max-nodes',String(p.nodes)]);
  const fallback=!analysis.has_result,move=fallback?state.moves[0]:analysis.bestmove;
  if(!state.moves.includes(move)||checkedPV(record.position,analysis.pv).length!==analysis.pv.length)throw Error('Illegal move/PV');
  const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Independent illegal move');
  game.moves.push({ply:prefix.length+1,side,variant,usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,fallback,analysis});prefix.push(move);
  if(ply%40===39)console.log(JSON.stringify({index,id:p.id,plies:ply+1}));
 }
 if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};
 game.status='finished';const kif=exportGame({initial:initialAfterOpening,moves:game.moves.map(m=>m.usi),result:JSON.stringify(game.result)});
 if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(game.moves.map(m=>m.usi)))throw Error('KIF mismatch');
 writeFileSync(dir+'/'+p.id+'.kif',kif);writeFileSync(path,JSON.stringify(game));
 console.log(JSON.stringify({index,id:p.id,finished:true,plies:game.moves.length,result:game.result}));
}
