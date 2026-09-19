import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Engine} from '../dist/engine.js';
import {positionAt,legalMoves,newGame} from '../dist/core.js';

// Exercise the real application event handlers, storage and clocks. This USI
// fixture controls scheduling only; engine quality is tested with real WASM.
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.classes=new Set();this.classList={toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
  append(...nodes){for(const n of nodes){if(n.tag==='#fragment')this.append(...n.children);else{n.parent=this;this.children.push(n);}}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  get firstChild(){return this.children[0];}
  remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
  querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)]);}
  querySelector(tag){return this.querySelectorAll(tag)[0];}
  setAttribute(k,v){this[k]=v;}
  scrollIntoView(){} focus(){} showModal(){this.open=true;} close(){this.open=false;}
  async click(){if(!this.disabled)return this.onclick?.();}
}
const settle=async test=>{for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setImmediate(r));}assert.fail('Application did not settle');};
test('played moves open a teacher conversation; time and the opponent wait for continue; retry and future questions preserve the game',async()=>{
  const ids=[...readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const nodes=new Map(ids.map(id=>[id,new Element()])),intervals=[],storage=new Map(),searches=[];
  const $=id=>{assert(nodes.has(id),'Missing DOM element '+id);return nodes.get(id);};$('guide').append(new Element('p'));
  const g=newGame({thinkTime:1000});storage.set('shogi-ai.current.v1',JSON.stringify(g));
  const saved=()=>JSON.parse(storage.get('shogi-ai.current.v1'));
  const originals={init:Engine.prototype.init,search:Engine.prototype.search,stop:Engine.prototype.stop,interval:globalThis.setInterval,now:Date.now};
  const descriptors=new Map(['document','window','navigator','localStorage','isSecureContext'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let now=100000,deferred=null,hold=false;
  Engine.prototype.init=async function(){this.ready=true;};
  Engine.prototype.stop=function(){this.generation++;deferred?.();deferred=null;};
  Engine.prototype.search=async function(initial,moves,options){
    searches.push({moves:[...moves],options});if(hold)await new Promise(r=>{deferred=r;});
    const p=positionAt(initial,moves),pv=[];for(let i=0;i<5;i++){const m=legalMoves(p)[0];if(!m)break;pv.push(m.usi);p.doMove(m);}
    return {bestmove:pv[0],infos:[{pv,rank:1,type:'cp',score:10,bound:false,depth:5}]};
  };
  const globals={document:{getElementById:$,createElement:t=>new Element(t),createDocumentFragment:()=>new Element('#fragment'),querySelectorAll:()=>[],addEventListener(){},body:new Element('body')},window:{addEventListener(){}},navigator:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},isSecureContext:false};
  for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
  globalThis.setInterval=f=>{intervals.push(f);return 1;};Date.now=()=>now;
  const square=usi=>$('board').children.find(n=>n.dataset.square===usi);
  const play=async(from,to)=>{await square(from).click();await square(to).click();};
  try{
    await import('../dist/app.js');await $('start').click();
    now+=2000;await play('7g','7f');await settle(()=>!$('teacher-continue').disabled);
    assert.deepEqual(saved().moves,['7g7f']);assert.equal(saved().teacherPending.move,'7g7f');assert.equal($('start').hidden,true);
    assert.match($('teacher-status').textContent,/時計は停止/);const clocks=saved().clocks;
    now+=60000;intervals[0]();
    assert.equal($('bottom-clock').textContent,'9:58');assert.equal($('top-clock').textContent,'10:00');
    assert(!searches.some(c=>c.options.multipv===1),'no opponent search before continue in this stable fixture');
    await import('../dist/app.js?restore=1');
    assert.equal($('start').hidden,true);assert.equal($('teacher-reanalyze').hidden,false,'a reload keeps the unfinished lesson paused');
    await $('teacher-reanalyze').click();await settle(()=>!$('teacher-continue').disabled);
    const attack=$('teacher-intents').children.find(n=>/攻め/.test(n.textContent));await attack.click();
    assert.equal($('teacher-intents').hidden,true);
    $('teacher-question').value='相手が3四歩なら？';await $('teacher-ask').onsubmit({preventDefault(){}});await settle(()=>!$('teacher-continue').disabled);
    assert(searches.some(c=>c.moves.join(' ')==='7g7f 3c3d'),'the intended opponent response is fixed before searching');
    const before=[...saved().moves];await $('teacher-look').click();assert.deepEqual(saved().moves,before);
    assert.match($('teacher-context').textContent,/検討 2手目/);assert(square('3d').children.some(n=>n.textContent==='歩'),'the displayed branch is the response the learner asked about');
    const count=searches.length;$('teacher-question').value='ここから何を目指す？';await $('teacher-ask').onsubmit({preventDefault(){}});
    await settle(()=>!$('teacher-continue').disabled);assert.equal(searches[count].moves.length,2,'future questions search the future root');
    assert.deepEqual(saved().moves,before);
    await $('teacher-origin').click();assert.match($('turn-status').textContent,/先生と一手/);
    await Promise.all([$('teacher-continue').click(),$('teacher-continue').click()]);
    assert.equal(saved().moves.length,2);assert.equal(saved().teacherPending,null);assert.equal(saved().teachingNotes[0].goal,'攻めを続けたい');
    assert.equal(searches.filter(c=>c.options.multipv===1&&c.moves.length===1).length,1,'exactly one opponent move');
    const p=positionAt(saved().initial,saved().moves),move=legalMoves(p)[0];await play(move.usi.slice(0,2),move.usi.slice(2,4));
    await settle(()=>!$('teacher-continue').disabled&&saved().moves.length===3);
    await $('teacher-retry').click();assert.equal(saved().moves.length,2);assert.equal(saved().teacherPending,null);assert(saved().variations.some(v=>v.moves.length===3));
    assert.equal($('pause').hidden,false,'retry resumes the human turn');assert.equal($('teacher-lesson').hidden,true);
    // A new game during a slow review must discard the late analysis, not speak
    // about its predecessor or advance the new opponent.
    hold=true;await play(move.usi.slice(0,2),move.usi.slice(2,4));await settle(()=>!!deferred);
    $('opening').value='standard';$('human-side').value='black';$('clock-mode').value='match';await $('new-game').click();hold=false;
    await settle(()=>$('teacher-lesson').hidden);assert.deepEqual(saved().moves,[]);assert.equal(saved().clockMode,'match');
    await $('start').click();await play('7g','7f');await settle(()=>saved().moves.length===2);
    assert.equal($('teacher-lesson').hidden,true);assert.equal(saved().teacherPending,null);
    assert.equal(clocks.black,598000);
  }finally{
    Engine.prototype.init=originals.init;Engine.prototype.search=originals.search;Engine.prototype.stop=originals.stop;globalThis.setInterval=originals.interval;Date.now=originals.now;
    for(const[k,d]of descriptors)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];
  }
});
