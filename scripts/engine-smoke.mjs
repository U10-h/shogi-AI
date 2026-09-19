import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {START,positionAt,parseInfo,checkedPV} from '../dist/core.js';
const dir=fileURLToPath(new URL('../dist/vendor/yaneuraou/',import.meta.url));
// The Emscripten data loader expects a browser location, even with preloaded data.
globalThis.location={pathname:dir};
const factory=createRequire(import.meta.url)(dir+'yaneuraou.js');
const data=readFileSync(dir+'yaneuraou.data');
const timeout=setTimeout(()=>{console.error('Engine smoke timed out');process.exit(1);},25000);
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
}finally{engine.terminate();clearTimeout(timeout);}
