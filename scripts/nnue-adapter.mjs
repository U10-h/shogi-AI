import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseInfo} from '../dist/core.js';

// The same shipped WASM/NNUE, exercised without a browser or paid service.
export async function createNNUE({hash=16,pvInterval=200,consideration=false,collector=null}={}){
  const dir=fileURLToPath(new URL('../dist/vendor/yaneuraou/',import.meta.url));
  globalThis.location={pathname:dir};
  const factory=createRequire(import.meta.url)(dir+'yaneuraou.js'),data=readFileSync(dir+'yaneuraou.data');
  const engine=await factory({wasmBinary:readFileSync(dir+'yaneuraou.wasm'),getPreloadedPackage:()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),locateFile:f=>dir+f,mainScriptUrlOrBlob:dir+'yaneuraou.js'});
  const listeners=new Set(),send=c=>engine.postMessage(c);
  engine.addMessageListener(line=>{for(const fn of listeners)fn(line);});
  const wait=(command,test)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(fn);reject(Error('NNUE timeout'));},60000);const fn=l=>{if(test(l)){clearTimeout(timer);listeners.delete(fn);resolve(l);}};listeners.add(fn);send(command);});
  await wait('usi',l=>l==='usiok');
  for(const [name,value]of Object.entries({USI_Hash:hash,Threads:1,USI_Ponder:false,USI_OwnBook:false,PvInterval:pvInterval,ConsiderationMode:consideration,EnteringKingRule:'CSARule27',ResignValue:99999}))send('setoption name '+name+' value '+value);
  await wait('isready',l=>l==='readyok');send('usinewgame');
  const api={calls:[],async search(initial,moves,{time=300,multipv=1}={}){
    const begin=performance.now(),latest=new Map(),batch=collector?new collector(multipv):null;
    const fn=line=>{const info=parseInfo(line);if(info){latest.set(info.rank,info);batch?.add(info);}};listeners.add(fn);
    try{send('setoption name MultiPV value '+multipv);send('position sfen '+initial+(moves.length?' moves '+moves.join(' '):''));
      const end=await wait('go movetime '+Math.round(time),l=>l.startsWith('bestmove '));
      const bestmove=end.split(' ')[1],infos=batch?batch.finish(bestmove):[...latest.values()].sort((a,b)=>a.rank-b.rank);
      const ms=performance.now()-begin;api.calls.push({moves:[...moves],time,multipv,ms:Math.round(ms),nodes:Math.max(0,...[...latest.values()].map(i=>i.nodes)),depth:infos[0]?.depth||0,coherent:new Set(infos.map(i=>i.depth)).size===1});
      return {bestmove,infos};
    }finally{listeners.delete(fn);}
  },stop(){send('stop');},terminate(){engine.terminate();},async reset(){send('usinewgame');await wait('isready',l=>l==='readyok');api.calls=[];}};
  return api;
}
