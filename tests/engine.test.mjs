import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../dist/engine.js';
import {START} from '../dist/core.js';
test('cancellation during initialization prevents a delayed search from starting',async()=>{
 const engine=new Engine();let finishInit;const sent=[];
 engine.init=()=>new Promise(resolve=>{finishInit=resolve;});engine.send=command=>sent.push(command);
 const search=engine.search(START,[],{time:30000});engine.stop();finishInit();
 await assert.rejects(search,{name:'AbortError'});assert.deepEqual(sent,[]);assert.equal(engine.searching,false);
});
