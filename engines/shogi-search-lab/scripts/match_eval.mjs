import {readFileSync,writeFileSync} from 'node:fs';
import {ROOT,BIN,START,lab,yaneura,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const dir=ROOT+'/results/v0.7',model=ROOT+'/experiments/positional-v0.7.txt';
const freeze=JSON.parse(readFileSync(dir+'/frozen-model.json'));
const protocol=JSON.parse(readFileSync(dir+'/protocol.json'));
const selected=freeze.selected;
if(hash(model)!==freeze.modelSha256)throw Error('Frozen model changed');
const openings=protocol.groups.filter(g=>g.split==='test');
const plans=[];
for(const o of openings)for(const side of ['black','white'])plans.push({id:'self-'+o.id+'-'+side,opening:o.opening,candidateSide:side,opponent:'material',candidate:selected,ms:300,maxPlies:200});
for(const [variant,side] of [['material','black'],[selected,'white'],['material','white'],[selected,'black']])plans.push({id:'yaneura-'+variant+'-'+side,opening:openings[0].opening,candidateSide:side,opponent:'yaneuraou',candidate:variant,ms:3000,maxPlies:160});
const result={schema:1,status:'running',binarySha256:hash(BIN),freeze,plans,settings:{ponder:false,book:false,preset:'tactical',threads:1,multiPV:1,reuseBetweenMoves:false},games:[]};
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
   if(variant==='learned')args.push('--eval-model',model);
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
