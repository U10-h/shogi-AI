// Prospective supplementary start-position control, after opening-balance audit.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {ROOT,START,ASSETS,lab,yaneura} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,exportGame,parseRecord} from './record_helpers.mjs';
const D=process.env.V21_RESULTS||ROOT+'/results/retrospective-20260927',read=p=>JSON.parse(readFileSync(p));
function save(p,x){mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});writeFileSync(p+'.tmp',JSON.stringify(x));renameSync(p+'.tmp',p);}
const other=c=>c==='black'?'white':'black';
function args(v){
 const a=['--advanced','--driver',v==='latest'?'adaptive':'pvs','--eval','nnue-cache','--eval-model',ASSETS+'/yaneuraou.data','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history','--depth','16','--iterative','--max-nodes','1000000000','--time-ms','1000'];
 if(v==='latest')a.push('--policy-model',ROOT+'/models/v0.17/all-policy.txt','--policy-mode','root');return a;
}
const t=await yaneura(D+'/startpos-usi.jsonl');
try{for(const side of ['black','white'])for(const v of (side==='black'?['latest','capture']:['capture','latest'])){
 const id=v+'-yaneuraou-startpos-'+side,path=D+'/matches/'+id+'.json';if(existsSync(path)&&read(path).status==='finished')continue;
 const g=existsSync(path)?read(path):{id,a:v,b:'yaneuraou',suite:'startpos',aSide:side,initial:START,opening:{id:'startpos',game:-1,prefix:[],sfen:START},ms:1000,opponentMs:1000,status:'running',moves:[],result:null};
 if(g.moves.length)(g.resumptions??=[]).push({at:new Date().toISOString(),afterMove:g.moves.length});
 const r=recordAt(START,g.moves.map(m=>m.usi));
 for(let ply=g.moves.length;ply<=200;ply++){
  const prefix=g.moves.map(m=>m.usi),state=await lab(prefix,['--legal']),color=r.position.color;
  if(state.repetition_score!==null){g.result={reason:state.repetition_score===0?'repetition':'perpetual-check',winner:state.repetition_score===0?null:state.repetition_score>0?color:other(color)};break;}
  if(!state.moves.length){if(hasLegalMove(r.position))throw Error('Terminal mismatch');g.result={reason:state.in_check?'checkmate':'no-legal-move',winner:other(color)};break;}
  if(ply===200)break;
  const own=color===side,variant=own?v:'yaneuraou',start=performance.now();let analysis,move,pv;
  if(own){analysis=await lab(prefix,args(v));pv=analysis.has_result?analysis.pv:analysis.fallback_pv;move=pv[0];analysis={...analysis,variant:v,chosenMove:move,pvLength:pv.length,wallMs:performance.now()-start};}
  else{await t.reset();analysis=await t.search(prefix,{ms:1000});move=analysis.move;pv=analysis.info?.pv;if(move==='resign'){g.result={reason:'resign',winner:other(color)};break;}}
  const wallMs=performance.now()-start;
  if(!state.moves.includes(move)||!pv||checkedPV(r.position,pv).length!==pv.length)throw Error('Illegal move/PV');
  const m=r.position.createMoveByUSI(move);if(!m||!r.position.isValidMove(m)||!r.append(m))throw Error('Independent legal mismatch');
  g.moves.push({ply:ply+1,side:color,variant,usi:move,beforeSfen:state.sfen,afterSfen:r.position.sfen,analysis,wallMs});save(path,g);
  if(ply%25===0)console.log(JSON.stringify({id,ply:ply+1}));
 }
 if(!g.result)g.result={reason:'move-limit',winner:null,unresolved:true};g.status='finished';save(path,g);
 const moves=g.moves.map(m=>m.usi),kif=exportGame({initial:START,moves,result:JSON.stringify(g.result)});
 if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(moves))throw Error('KIF mismatch');writeFileSync(D+'/matches/'+id+'.kif',kif);
 console.log(JSON.stringify({id,plies:moves.length,result:g.result}));
}}finally{t.close();}
