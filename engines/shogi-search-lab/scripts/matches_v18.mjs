import {writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {START,lab,yaneura} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
import {D,read,save,run,checkProtocol} from './experiment_v18.mjs';
const worker=Number(process.argv[2]);if(!Number.isInteger(worker)||worker<0||worker>3)throw Error('worker 0..3');
const P=checkProtocol(),selected=read(D+'/selection.json').selected,side=P.matches.sides[worker%2],ms=P.matches.ourMs[Math.floor(worker/2)];
const other=c=>c==='black'?'white':'black';
const teacher=await yaneura(D+'/matches-usi-'+worker+'.jsonl');
try{for(const name of (worker%2?['root',selected]:[selected,'root'])){
 const id=side+'-'+ms+'-'+name,path=D+'/matches/'+id+'.json';if(existsSync(path)&&read(path).status==='finished')continue;
 const game=existsSync(path)?read(path):{id,name,candidateSide:side,ms,opponentMs:P.matches.opponentMs,opening:[],initial:START,worker,cpuAffinity:execFileSync('taskset',['-pc',String(process.pid)],{encoding:'utf8'}).trim(),status:'running',moves:[],result:null};
 if(game.name!==name||game.ms!==ms||game.candidateSide!==side)throw Error('Resume protocol mismatch');
 if(game.moves.length)(game.resumptions??=[]).push({at:new Date().toISOString(),afterPly:game.moves.length,reason:'Execution environment restart; each move already uses fresh/reset engines'});
 const record=recordAt(START,game.moves.map(m=>m.usi));save(path,game);
 for(let ply=game.moves.length;ply<=P.matches.maxPlies;ply++){
  const prefix=game.moves.map(m=>m.usi),state=await lab(prefix,['--legal']),color=record.position.color;
  if(state.repetition_score!==null){game.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?color:other(color)};break;}
  if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(color)};break;}
  if(ply===P.matches.maxPlies)break;
  const own=color===side;let analysis,move,wallMs;const start=performance.now();
  if(own){analysis=await run(prefix,name,ms);move=analysis.chosenMove;wallMs=performance.now()-start;}
  else{await teacher.reset();analysis=await teacher.search(prefix,{ms:P.matches.opponentMs});move=analysis.move;wallMs=analysis.wallMs;if(move==='resign'){game.result={reason:'resign',winner:other(color)};break;}}
  if(!state.moves.includes(move))throw Error('Illegal move');
  const pv=own?(analysis.has_result?analysis.pv:analysis.fallback_pv):analysis.info?.pv;
  if(pv&&checkedPV(record.position,pv).length!==pv.length)throw Error('Invalid PV');
  const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Independent legal-move mismatch');
  game.moves.push({ply:ply+1,side:color,variant:own?name:'yaneuraou',usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,analysis,wallMs});save(path,game);
  if(ply%20===0)console.log(JSON.stringify({id,ply:ply+1,move}));
 }
 if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};game.status='finished';save(path,game);
 const moves=game.moves.map(m=>m.usi),kif=exportGame({initial:START,moves,result:JSON.stringify(game.result)});
 if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(moves))throw Error('KIF round trip mismatch');writeFileSync(D+'/matches/'+id+'.kif',kif);
 console.log(JSON.stringify({id,plies:moves.length,result:game.result}));
}}finally{teacher.close();}
