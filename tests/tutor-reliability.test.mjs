import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {LocalTutor,selectTutorEvidence,validateTutorReply} from '../dist/tutor.js';
import {TutorGenerationQueue} from '../dist/tutor-generation.js';

const fixture=JSON.parse(readFileSync(new URL('../docs/experiments/tutor-regression-cases.json',import.meta.url),'utf8'));
test('Known wrong explanations are refused and grounded explanations stay available',()=>{
  for(const c of fixture.cases){
    const run=()=>validateTutorReply(JSON.stringify({answer:c.answer,evidence_ids:c.ids}),fixture.evidence);
    if(c.accept)assert.doesNotThrow(run,c.id);else assert.throws(run,undefined,c.id);
  }
});
test('Comparison evidence keeps two complete seven-ply branches and typed provenance',()=>{
  const moves=['７六歩','３四歩','２六歩','８四歩','２五歩','８五歩','７八金'];
  const evidence=[{id:'position',text:'先手の局面。'},{id:'teacher',text:'講評。'.repeat(200)},...['defense','best'].map(id=>({id,kind:'line',title:id,moves,resultText:'先手視点の評価 +120。'+('有限時間の探索。'.repeat(20))})),{id:'comparison',text:'比較。'.repeat(200)}];
  for(const question of ['最善手と指した手を比較したい','7手先まで複数の展開を比較したい','今後の方針を考えたい']){
    const packed=selectTutorEvidence(evidence,question,{style:'teacher'});
    for(const id of ['defense','best']){const branch=packed.find(e=>e.id===id);assert.equal(branch.kind,'line');assert.deepEqual(branch.moves,moves);for(const move of moves)assert(branch.text.includes(move));}
    assert(packed.reduce((n,e)=>n+e.text.length,0)<=1100);
  }
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('An interrupted generation releases its caller immediately; a late response is ignored',async()=>{
  const tutor=new LocalTutor(),messages=[];tutor.worker={postMessage:m=>messages.push(m),terminate(){}};tutor.ready=true;
  const old=tutor.answer('この手は？',fixture.evidence);
  const rejected=assert.rejects(old,{name:'AbortError'});
  tutor.interrupt();await rejected;assert.equal(tutor.pending.size,0);assert.equal(tutor.ready,true);
  assert.equal(messages.at(-1).type,'interrupt');
  const fresh=tutor.request('answer');assert.equal(tutor.pending.size,1);assert.notEqual(messages.at(-1).id,messages[0].id);
  const stopped=assert.rejects(fresh,/停止/);tutor.unload();await stopped;
});
test('New decoding waits for interrupted decoding and stale output never completes successfully',async()=>{
  const queue=new TutorGenerationQueue(),gate=deferred();let active=0,maxActive=0;
  const old=queue.run(async()=>{active++;maxActive=Math.max(maxActive,active);await gate.promise;active--;return 'old';});
  const rejected=assert.rejects(old,{name:'AbortError'});await Promise.resolve();
  queue.interrupt();
  const fresh=queue.run(async()=>{active++;maxActive=Math.max(maxActive,active);active--;return 'fresh';});
  assert.equal(active,1);gate.resolve();await rejected;assert.equal(await fresh,'fresh');assert.equal(maxActive,1);
  const failed=queue.run(()=>{throw Error('decode failed');});await assert.rejects(failed,/decode failed/);
  assert.equal(await queue.run(()=>42),42,'one failure does not poison later questions');
});
test('Reload survives a late failure from the model it replaced',async()=>{
  const descriptors=new Map(['navigator','isSecureContext','Worker'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const adapters=[],workers=[];
  class Worker {constructor(){this.messages=[];workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){this.stopped=true;}}
  const globals={isSecureContext:true,navigator:{gpu:{requestAdapter(){const d=deferred();adapters.push(d);return d.promise;}}},Worker};
  for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
  const tutor=new LocalTutor();
  try{
    const old=tutor.load();const rejected=assert.rejects(old,/old GPU failure/);assert.equal(tutor.load(),old,'double clicks share initialization');
    tutor.unload();const fresh=tutor.load();
    adapters[1].resolve({features:new Set(['shader-f16'])});await Promise.resolve();
    adapters[0].reject(Error('old GPU failure'));await rejected;
    assert.equal(tutor.worker,workers[0]);assert(!workers[0].stopped);
    const load=workers[0].messages[0];workers[0].onmessage({data:{id:load.id,result:true}});await fresh;assert(tutor.ready);
    const answering=tutor.answer('この手は？',fixture.evidence);const interrupted=assert.rejects(answering,{name:'AbortError'});
    const answerId=workers[0].messages.at(-1).id;tutor.interrupt();await interrupted;
    workers[0].onmessage({data:{id:answerId,result:'late'}});assert.equal(tutor.pending.size,0);
  }finally{tutor.unload();for(const [k,d]of descriptors)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}
});
test('Service worker precaches the full local module dependency tree including optional dialogue',()=>{
  const events=new Map();let shell;
  const root=new URL('../dist/',import.meta.url);
  runInNewContext(readFileSync(new URL('sw.js',root),'utf8'),{URL,Response,self:{location:'https://shogi.example/',addEventListener:(name,fn)=>events.set(name,fn),skipWaiting(){}},caches:{open:async()=>({addAll:files=>{shell=files;}})}});
  return new Promise((resolve,reject)=>events.get('install')({waitUntil:promise=>promise.then(()=>{
    try{
      const cached=new Set(shell.map(s=>new URL(s,root).href));
      for(const file of shell.filter(s=>s.endsWith('.js')&&!s.includes('/vendor/'))){
        const url=new URL(file,root),source=readFileSync(url,'utf8');
        for(const m of source.matchAll(/(?:from\s+|import\s+)['"](\.\.?\/[^'"]+)['"]/g))assert(cached.has(new URL(m[1],url).href),'Missing offline dependency: '+m[1]);
      }
      resolve();
    }catch(e){reject(e);}
  },reject)}));
});
