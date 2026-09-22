import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const BIN=resolve(process.env.SHOGI_LAB_BIN||ROOT+'/build/shogi-lab');
export const ASSETS=resolve(process.env.YANEURAOU_ASSETS||'/workspace/sites/shogi-ai/dist/vendor/yaneuraou');
export const START='lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
export const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export function parseInfo(line){
 if(!line.startsWith('info ')||!line.includes(' pv '))return null;
 const match=line.match(/score (cp|mate) (-?\d+)/);if(!match)return null;
 const get=k=>Number(line.match(new RegExp('(?:^| )'+k+' (\\d+)'))?.[1]||0);
 return {type:match[1],score:Number(match[2]),depth:get('depth'),nodes:get('nodes'),time:get('time'),rank:get('multipv')||1,bound:/\b(lowerbound|upperbound)\b/.test(line),pv:line.split(' pv ')[1].trim().split(/\s+/)};
}
export function lab(moves,args=[],initial=START){
 return new Promise((resolve,reject)=>{
  const child=spawn(BIN,['--sfen',initial,'--moves',moves.join(' '),...args]);let out='',err='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Lab watchdog timeout'));},60000);
  child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);if(![0,3].includes(code))reject(Error('Lab '+code+': '+err));else try{resolve(JSON.parse(out));}catch(e){reject(e);}});
 });
}
export async function yaneura(transcript){
 const log=(direction,line)=>transcript&&appendFileSync(transcript,JSON.stringify({at:new Date().toISOString(),engine:'yaneuraou',direction,line})+'\n');
 const dir=ASSETS+'/';globalThis.location={pathname:dir};
 const factory=createRequire(import.meta.url)(dir+'yaneuraou.js'),data=readFileSync(dir+'yaneuraou.data');
 const engine=await factory({wasmBinary:readFileSync(dir+'yaneuraou.wasm'),getPreloadedPackage:()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),locateFile:f=>dir+f,mainScriptUrlOrBlob:dir+'yaneuraou.js'});
 const listeners=new Set();engine.addMessageListener(line=>{log('out',line);for(const fn of listeners)fn(line);});
 const send=line=>{log('in',line);engine.postMessage(line);};
 const request=(command,predicate)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{listeners.delete(fn);reject(Error('YaneuraOu watchdog timeout: '+command));},60000);
  const fn=line=>{if(predicate(line)){clearTimeout(timer);listeners.delete(fn);resolve(line);}};listeners.add(fn);send(command);
 });
 const handshake=[],collect=l=>handshake.push(l);listeners.add(collect);await request('usi',l=>l==='usiok');listeners.delete(collect);
 const options={Threads:1,USI_Hash:32,USI_Ponder:false,Stochastic_Ponder:false,MultiPV:1,USI_OwnBook:false,BookFile:'no_book',PvInterval:100,ResignValue:99999,EnteringKingRule:'NoEnteringKing',NetworkDelay:0,NetworkDelay2:0,MinimumThinkingTime:1000,SkillLevel:20,DrawValueBlack:0,DrawValueWhite:0};
 for(const [name,value]of Object.entries(options)){
  if(!handshake.some(l=>l.startsWith('option name '+name+' type ')))throw Error('Missing opponent option '+name);
  send('setoption name '+name+' value '+value);
 }
 await request('isready',l=>l==='readyok');
 return {name:handshake.find(l=>l.startsWith('id name '))?.replace(/^(id name )+/,'').trim(),options,handshake,
  async reset(){send('usinewgame');await request('isready',l=>l==='readyok');},
  async search(moves,{ms=3000,initial=START,searchmoves=[],depth=null,nodes=null,multipv=1}={}){
   send('setoption name MultiPV value '+multipv);
   const infos=[],onInfo=l=>{const i=parseInfo(l);if(i)infos.push(i);};listeners.add(onInfo);
   try{
    send('position sfen '+initial+(moves.length?' moves '+moves.join(' '):''));
    const begin=performance.now();const command='go '+(depth?'depth '+depth:nodes?'nodes '+nodes:'movetime '+ms)+(searchmoves.length?' searchmoves '+searchmoves.join(' '):'');
    const response=await request(command,l=>l.startsWith('bestmove '));const move=response.split(' ')[1];
    const best=[...infos].reverse().find(i=>i.pv[0]===move&&!i.bound)||infos.at(-1);
    return {move,wallMs:performance.now()-begin,info:best,infos};
   }finally{listeners.delete(onInfo);}
  },close(){engine.terminate();}
 };
}
