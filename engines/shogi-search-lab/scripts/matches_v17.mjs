import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ROOT,START,lab,yaneura} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
import {D,save,run,signatures} from './experiment_v17.mjs';
const read=p=>JSON.parse(readFileSync(p)),P=read(D+'/protocol.json'),selection=read(D+'/selection.json');
if(JSON.stringify(signatures())!==JSON.stringify(P.signatures))throw Error('Frozen signature mismatch');
const worker=Number(process.argv[2]),other=c=>c==='black'?'white':'black';
if(!Number.isInteger(worker)||worker<0||worker>3)throw Error('worker 0..3 required');
mkdirSync(D+'/matches',{recursive:true});
const teacher=await yaneura(D+'/matches-usi-'+worker+'.jsonl');
try{for(let oid=0;oid<2;oid++)for(let ci=0;ci<2;ci++)for(let ti=0;ti<2;ti++)for(let vi=0;vi<2;vi++){
 const block=2*oid+ci;if((vi+2*ti+block)%4!==worker)continue;
 const opening=P.matches.openings[oid],side=P.matches.colors[ci],ms=P.matches.ms[ti],name=['adaptive',selection.selected][vi];
 const id=oid+'-'+side+'-'+ms+'-'+name,path=D+'/matches/'+id+'.json';
 if(existsSync(path)&&read(path).status==='finished')continue;
 const game={id,name,candidateSide:side,opening,initial:START,ms,opponentMs:2000,worker,cpuAffinity:execFileSync('taskset',['-pc',String(process.pid)],{encoding:'utf8'}).trim(),status:'running',moves:[],result:null};
 const record=recordAt(START,opening);save(path,game);
 for(let ply=0;ply<=P.matches.maxPlies;ply++){
  const prefix=[...opening,...game.moves.map(m=>m.usi)],state=await lab(prefix,['--legal']),color=record.position.color;
  if(state.repetition_score!==null){game.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?color:other(color)};break;}
  if(!state.moves.length){if(hasLegalMove(record.position))throw Error('Terminal mismatch');game.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(color)};break;}
  if(ply===P.matches.maxPlies)break;
  const own=color===side;let analysis,move,wallMs;const begin=performance.now();
  if(own){analysis=await run(prefix,name,ms);move=analysis.chosenMove;wallMs=performance.now()-begin;}
  else {await teacher.reset();analysis=await teacher.search(prefix,{ms:2000});move=analysis.move;wallMs=analysis.wallMs;
   if(move==='resign'){game.result={reason:'resign',winner:other(color)};break;}}
  if(!state.moves.includes(move))throw Error('Illegal move '+move);
  const pv=own?(analysis.has_result?analysis.pv:analysis.fallback_pv):analysis.info?.pv;
  if(pv&&checkedPV(record.position,pv).length!==pv.length)throw Error('Illegal PV');
  const m=record.position.createMoveByUSI(move);if(!m||!record.position.isValidMove(m)||!record.append(m))throw Error('Independent move mismatch');
  game.moves.push({ply:prefix.length+1,side:color,variant:own?name:'yaneuraou',usi:move,beforeSfen:state.sfen,afterSfen:record.position.sfen,analysis,wallMs});save(path,game);
  if(ply%20===0)console.log(JSON.stringify({worker,id,ply:prefix.length+1,move}));
 }
 if(!game.result)game.result={reason:'move-limit',winner:null,unresolved:true};game.status='finished';save(path,game);
 const all=[...opening,...game.moves.map(m=>m.usi)],kif=exportGame({initial:START,moves:all,result:JSON.stringify(game.result)});
 if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(all))throw Error('KIF mismatch');writeFileSync(D+'/matches/'+id+'.kif',kif);
 console.log(JSON.stringify({worker,id,plies:all.length,result:game.result}));
}}finally{teacher.close();}
