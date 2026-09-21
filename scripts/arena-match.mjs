import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {START,recordAt,parseInfo,checkedPV,moveLabel,hasLegalMove,exportGame} from '../dist/core.js';

const budget=Number(process.env.MATCH_MS||3000),games=Number(process.env.MATCH_GAMES||2);
const binary=resolve(process.env.SHOGI_LAB_BIN||'engines/shogi-search-lab/build/shogi-lab');
const output=resolve(process.env.MATCH_OUTPUT||'dist/arena-data.json');
const logDir=resolve(process.env.MATCH_LOG_DIR||'docs/arena');mkdirSync(logDir,{recursive:true});
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const transcript=logDir+'/protocol.jsonl';writeFileSync(transcript,'');
const log=(engine,direction,line)=>appendFileSync(transcript,JSON.stringify({at:new Date().toISOString(),engine,direction,line})+'\n');
function labProcess(){
 const child=spawn(binary,['--session','--time-ms',String(budget)],{stdio:['pipe','pipe','pipe']});
 const queued=[],waiters=[];let failure;
 const fail=e=>{failure=e;for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(e);}};
 child.on('error',fail);child.on('exit',(code)=>{if(code!==0)fail(Error('Lab exited '+code));});
 child.stderr.on('data',b=>log('lab','stderr',b.toString()));
 createInterface({input:child.stdout}).on('line',line=>{log('lab','out',line);try{const r=JSON.parse(line);const w=waiters.shift();if(w){clearTimeout(w.timer);w.resolve(r);}else queued.push(r);}catch(e){fail(e);}});
 const next=()=>queued.length?Promise.resolve(queued.shift()):failure?Promise.reject(failure):new Promise((resolve,reject)=>{const w={resolve,reject,timer:setTimeout(()=>{fail(Error('Lab response timeout'));},15000)};waiters.push(w);});
 return {ready:next(),async request(command){log('lab','in',command);child.stdin.write(command+'\n');const r=await next();if(r.event==='error')throw Error(r.error);return r;},close(){child.stdin.end('quit\n');setTimeout(()=>{if(child.exitCode===null)child.kill();},200).unref();}};
}
async function yaneura(){
 const dir=resolve('dist/vendor/yaneuraou')+'/';globalThis.location={pathname:dir};
 const factory=createRequire(import.meta.url)(dir+'yaneuraou.js'),data=readFileSync(dir+'yaneuraou.data');
 const engine=await factory({wasmBinary:readFileSync(dir+'yaneuraou.wasm'),getPreloadedPackage:()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),locateFile:f=>dir+f,mainScriptUrlOrBlob:dir+'yaneuraou.js'});
 const listeners=new Set(),handshake=[];engine.addMessageListener(l=>{log('yaneuraou','out',l);for(const fn of listeners)fn(l);});
 const send=c=>{log('yaneuraou','in',c);engine.postMessage(c);};
 const request=(c,predicate)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(fn);reject(Error('YaneuraOu response timeout'));},20000);const fn=l=>{if(predicate(l)){clearTimeout(timer);listeners.delete(fn);resolve(l);}};listeners.add(fn);send(c);});
 const collect=l=>handshake.push(l);listeners.add(collect);await request('usi',l=>l==='usiok');listeners.delete(collect);
 const options={Threads:1,USI_Hash:32,USI_Ponder:false,MultiPV:1,BookFile:'no_book',PvInterval:100,ResignValue:99999,EnteringKingRule:'NoEnteringKing',NetworkDelay:0,NetworkDelay2:0,MinimumThinkingTime:1000};
 for(const [name,value]of Object.entries(options)){
  if(!handshake.some(l=>l.startsWith('option name '+name+' type ')))throw Error('Missing engine option '+name);
  send('setoption name '+name+' value '+value);
 }
 await request('isready',l=>l==='readyok');
 return {name:handshake.find(l=>l.startsWith('id name '))?.slice(8),options,async reset(){send('usinewgame');await request('isready',l=>l==='readyok');},async search(moves){
  const info=[];const fn=l=>{const r=parseInfo(l);if(r)info.push(r);};listeners.add(fn);
  try{send('position startpos'+(moves.length?' moves '+moves.join(' '):''));const start=performance.now();const end=await request('go movetime '+budget,l=>l.startsWith('bestmove '));return {move:end.split(' ')[1],wallMs:performance.now()-start,info};}finally{listeners.delete(fn);}
 },close(){engine.terminate();}};
}
const result={schema:1,recordedAt:new Date().toISOString(),status:'running',settings:{timeMs:budget,ponder:false,opening:'平手・初期局面',maxPlies:256,enteringKing:false,lab:{version:'0.4',binarySha256:sha(binary),sourceArchiveSha256:process.env.LAB_ARCHIVE_SHA||null,rootPolicy:'screen',treeNodes:50000,maxDepth:8,maxNodes:1000000000,threads:1},opponent:{version:'6.03',variant:'NNUE KP256 / WASM 0.1.2',evaluation:'2019-01-15 KP256',wasmSha256:sha('dist/vendor/yaneuraou/yaneuraou.wasm'),evaluationSha256:sha('dist/vendor/yaneuraou/yaneuraou.data')}},games:[]};
function save(){writeFileSync(output+'.tmp',JSON.stringify(result,null,2));renameSync(output+'.tmp',output);}
let opponent;
try{
 opponent=await yaneura();result.settings.opponent.name=opponent.name;result.settings.opponent.options=opponent.options;
 for(let index=0;index<games;index++){
  await opponent.reset();const lab=labProcess();await lab.ready;
  const labSide=index%2===0?'black':'white';const game={id:'game-'+(index+1),labSide,initial:START,startedAt:new Date().toISOString(),moves:[],status:'running',result:null};result.games.push(game);save();
  const record=recordAt(START,[]);
  try{for(let ply=0;ply<result.settings.maxPlies;ply++){
   const p=record.position,color=p.color;
   if(record.repetition){game.result={reason:record.perpetualCheck?'perpetual-check':'repetition',winner:record.perpetualCheck?(record.perpetualCheck==='black'?'white':'black'):null};break;}
   if(!hasLegalMove(p)){game.result={reason:p.checked?'checkmate':'no-legal-move',winner:color==='black'?'white':'black'};break;}
   let move,analysis,wallMs;const isLab=color===labSide;
   if(isLab){const start=performance.now();const a=await lab.request('go depth 8 time '+budget+' nodes 1000000000');wallMs=performance.now()-start;const v=a.position;if(!v.candidates_complete||!v.candidates.length)throw Error('Lab has no completed root ranking');move=v.candidates[0].move;
    analysis={depth:v.completed_depth,score:v.score,type:Math.abs(v.score)>=99000?'lab-mate':'cp',pv:v.pv,candidates:v.candidates,nodes:a.nodes,engineMs:a.elapsed_ms,stopReason:a.stop_reason,exactHits:a.exact_hits,boundHits:a.bound_hits,rootScreens:a.root_screens,rootExclusions:a.root_exclusions,treeNodes:v.tree_nodes};
   }else{const a=await opponent.search(game.moves.map(m=>m.usi));move=a.move;wallMs=a.wallMs;
    if(move==='resign'){game.result={reason:'resign',winner:labSide};break;}
    if(move==='win')throw Error('Unexpected entering-king claim with disabled declaration');
    const i=[...a.info].reverse().find(i=>i.pv[0]===move&&!i.bound)||a.info.at(-1);
    analysis=i?{...i,engineMs:i.time,pv:i.pv,candidates:[{rank:1,move,score:i.score,depth:i.depth,pv:i.pv}],score:i.score}:null;
   }
   const legal=p.createMoveByUSI(move);if(!legal||!p.isValidMove(legal))throw Error('Illegal '+(isLab?'Lab':'YaneuraOu')+' move: '+move);
   for(const candidate of analysis?.candidates||[])if(checkedPV(p,candidate.pv).length!==candidate.pv.length)throw Error('Invalid PV');
   const row={ply:ply+1,side:color,engine:isLab?'lab':'yaneuraou',usi:move,label:moveLabel(p,move),beforeSfen:p.sfen,wallMs:Math.round(wallMs*100)/100,analysis};
   if(!record.append(legal))throw Error('Record append failed');
   const advance=await lab.request('advance '+move);row.reusedTree=advance.reused_tree;row.previousRank=advance.previous_rank;row.afterSfen=record.position.sfen;row.check=record.position.checked;
   if(advance.position.sfen.split(' ').slice(0,3).join(' ')!==row.afterSfen.split(' ').slice(0,3).join(' '))throw Error('Lab and independent board disagree');
   game.moves.push(row);save();console.log(JSON.stringify({game:index+1,ply:ply+1,engine:row.engine,move,ms:row.wallMs,depth:analysis?.depth,score:analysis?.score,check:row.check}));
  }
  if(!game.result)game.result={reason:'move-limit',winner:null};game.status='finished';game.finishedAt=new Date().toISOString();
  writeFileSync(logDir+'/'+game.id+'.kif',exportGame({initial:START,moves:game.moves.map(m=>m.usi),result:JSON.stringify(game.result)}));
  console.log(JSON.stringify({game:index+1,result:game.result,plies:game.moves.length}));
  }finally{lab.close();save();}
 }
 result.status='finished';result.finishedAt=new Date().toISOString();save();
}catch(e){result.status='error';result.error=e.message;save();throw e;}finally{opponent?.close();}
