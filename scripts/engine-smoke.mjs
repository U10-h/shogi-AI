import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {START,positionAt,parseInfo,checkedPV} from '../dist/core.js';
import {investigate,explainReport,branchRoot,lineOutlook,explainPlan} from '../dist/coach-analysis.js';
import {reviewPlayedMove,teacherComment,teacherAnswer} from '../dist/teacher-analysis.js';
import {prepareTeaching,teachingReady} from '../dist/teaching-lines.js';
const dir=fileURLToPath(new URL('../dist/vendor/yaneuraou/',import.meta.url));
// The Emscripten data loader expects a browser location, even with preloaded data.
globalThis.location={pathname:dir};
const factory=createRequire(import.meta.url)(dir+'yaneuraou.js');
const data=readFileSync(dir+'yaneuraou.data');
const timeout=setTimeout(()=>{console.error('Engine smoke timed out');process.exit(1);},45000);
const engine=await factory({wasmBinary:readFileSync(dir+'yaneuraou.wasm'),getPreloadedPackage:()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),locateFile:f=>dir+f,mainScriptUrlOrBlob:dir+'yaneuraou.js'});
const lines=[];const listeners=new Set();engine.addMessageListener(line=>{lines.push(line);for(const fn of listeners)fn(line);});
function request(command,end){return new Promise(resolve=>{const fn=line=>{if(end(line)){listeners.delete(fn);resolve(line);}};listeners.add(fn);engine.postMessage(command);});}
try{
  await request('usi',l=>l==='usiok');
  console.log(lines.filter(l=>l.startsWith('id name')).join('\n'));
  engine.postMessage('setoption name USI_Hash value 32');
  engine.postMessage('setoption name Threads value 1');
  engine.postMessage('setoption name MultiPV value 3');
  await request('isready',l=>l==='readyok');engine.postMessage('usinewgame');
  const moves=['7g7f'];const p=positionAt(START,moves);
  engine.postMessage('position startpos moves '+moves.join(' '));
  const best=await request('go movetime 700',l=>l.startsWith('bestmove '));
  const move=p.createMoveByUSI(best.split(' ')[1]);assert(move&&p.isValidMove(move));
  const infos=lines.map(parseInfo).filter(Boolean);assert(infos.length>0);assert(infos.some(i=>i.rank===3));
  assert(infos.every(i=>checkedPV(p,i.pv).length===i.pv.length));
  engine.postMessage('position startpos');
  const stopped=request('go movetime 10000',l=>l.startsWith('bestmove '));setTimeout(()=>engine.postMessage('stop'),150);await stopped;
  moves.push(move.usi);engine.postMessage('position startpos moves '+moves.join(' '));
  const next=await request('go movetime 300',l=>l.startsWith('bestmove '));
  const q=positionAt(START,moves),m=q.createMoveByUSI(next.split(' ')[1]);assert(m&&q.isValidMove(m));
  console.log('PASS: NNUE initialization, legal AI reply, MultiPV 3, legal variations, stop and next search');
  const adapter={async search(initial,moves,{time,multipv}){
    const start=lines.length;
    engine.postMessage('setoption name MultiPV value '+multipv);
    engine.postMessage('position sfen '+initial+(moves.length?' moves '+moves.join(' '):''));
    const result=await request('go movetime '+time,l=>l.startsWith('bestmove '));
    const infos=new Map();for(const line of lines.slice(start)){const value=parseInfo(line);if(value)infos.set(value.rank,value);}
    return {bestmove:result.split(' ')[1],infos:[...infos.values()]};
  }};
  const report=await investigate(adapter,{initial:START,moves:[]},'7g7f',{time:400,reply:'8c8d'});
  assert.equal(report.chosen,'7g7f');assert.equal(report.assumption.pv[1],'8c8d');
  assert.ok(report.defense.evidence.moves.length>=2);assert.match(explainReport(report,'defense'),/最善応手/);
  for(const b of [report.best,report.defense,report.opportunity,report.assumption].filter(Boolean))assert.equal(checkedPV(positionAt(START,[]),b.pv).length,b.pv.length);
  console.log('PASS: real NNUE candidate assessment, best-move comparison, opponent-response hypothesis and explanation');
  const advanced=branchRoot(report.root,report.assumption);
  const continuation=await investigate(adapter,advanced,null,{time:300});
  assert.equal(continuation.root.moves.length,2);assert.equal(continuation.side,report.side);
  assert.equal(checkedPV(positionAt(advanced.initial,advanced.moves),continuation.defense.pv).length,continuation.defense.pv.length);
  const outlook=lineOutlook(advanced,continuation.defense,report.side);
  assert.ok(outlook.plies>0);assert.match(explainPlan(continuation),/嬉しい展開/);
  assert.deepEqual(report.root.moves,[]);
  console.log('PASS: real NNUE follow-up from two plies later, preserved history and evidence-based outlooks');
  const deep=await investigate(adapter,{initial:START,moves:[]},'7g7f',{time:250,rigor:'deep'});
  assert.equal(deep.rigor,'deep');assert(deep.verification.candidates.length>=2);assert(deep.verification.replies.length>=1);
  for(const b of [...deep.verification.candidates,...deep.verification.replies])assert.equal(checkedPV(positionAt(START,[]),b.pv).length,b.pv.length);
  assert.match(explainReport(deep,'verify'),/読み直しました/);
  console.log('PASS: real NNUE wide candidate search, focused equal-budget review and fixed-reply analysis');
  const teaching=await prepareTeaching(adapter,deep,{time:1000});
  assert(teachingReady(teaching));assert(teaching.teaching.lines.length>=3);
  for(const b of teaching.teaching.lines){assert(b.pv.length>=7||b.reading.terminal);assert.equal(checkedPV(positionAt(START,[]),b.pv).length,b.pv.length);}
  console.log('PASS: real NNUE teaching compares '+teaching.teaching.lines.length+' scenarios, each with at least seven legal plies or an explicit ending');
  if(process.env.SHOGI_TEACHING_FIXTURE_PATH)writeFileSync(process.env.SHOGI_TEACHING_FIXTURE_PATH,JSON.stringify(teaching));
  const lesson=await reviewPlayedMove(adapter,{initial:START,moves:[]},'7g7f',{time:250});
  const comment=teacherComment(lesson,{first:true});assert.ok(comment.text.length>30);assert.ok(comment.text.length<300);
  assert.equal(checkedPV(positionAt(START,[]),lesson.defense.pv).length,lesson.defense.pv.length);
  assert.match(teacherAnswer(lesson,{goal:'develop'}),/駒を働かせたい/);
  console.log('PASS: real NNUE played-move review, grounded teaching comment and intent response');
  // The browser uses isolated workers. Also verify two real engine instances can
  // search different histories concurrently without mixing PVs or scores.
  const observer=await factory({wasmBinary:readFileSync(dir+'yaneuraou.wasm'),getPreloadedPackage:()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),locateFile:f=>dir+f,mainScriptUrlOrBlob:dir+'yaneuraou.js'});
  const observerLines=[],observerListeners=new Set();observer.addMessageListener(line=>{observerLines.push(line);for(const fn of observerListeners)fn(line);});
  const observeRequest=(command,end)=>new Promise(resolve=>{const fn=line=>{if(end(line)){observerListeners.delete(fn);resolve(line);}};observerListeners.add(fn);observer.postMessage(command);});
  try{
    await observeRequest('usi',l=>l==='usiok');observer.postMessage('setoption name USI_Hash value 16');observer.postMessage('setoption name Threads value 1');await observeRequest('isready',l=>l==='readyok');observer.postMessage('usinewgame');
    const observerAdapter={async search(initial,moves,{time,multipv}){
      const start=observerLines.length;observer.postMessage('setoption name MultiPV value '+multipv);observer.postMessage('position sfen '+initial+(moves.length?' moves '+moves.join(' '):''));
      const end=await observeRequest('go movetime '+time,l=>l.startsWith('bestmove '));const infos=new Map();for(const line of observerLines.slice(start)){const value=parseInfo(line);if(value)infos.set(value.rank,value);}return {bestmove:end.split(' ')[1],infos:[...infos.values()]};
    }};
    const [reply,watched]=await Promise.all([adapter.search(START,['7g7f'],{time:700,multipv:1}),reviewPlayedMove(observerAdapter,{initial:START,moves:[]},'7g7f',{time:200})]);
    const opponent=positionAt(START,['7g7f']);assert(opponent.isValidMove(opponent.createMoveByUSI(reply.bestmove)));
    assert.equal(watched.root.moves.length,0);assert.equal(checkedPV(positionAt(START,[]),watched.defense.pv).length,watched.defense.pv.length);
    console.log('PASS: two real NNUE engines run an opponent turn and background teaching concurrently');
    console.log('Teacher sample: '+teacherComment(watched).text);
  }finally{observer.terminate();}

}finally{engine.terminate();clearTimeout(timeout);}
