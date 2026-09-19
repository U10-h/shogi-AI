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
test('background analysis never blocks play; a confirmed warning can be opened, resumed and retried from its historical move',async()=>{
  const ids=[...readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const nodes=new Map(ids.map(id=>[id,new Element()])),intervals=[],storage=new Map(),searches=[];
  const $=id=>{assert(nodes.has(id),'Missing DOM element '+id);return nodes.get(id);};$('guide').append(new Element('p'));
  const g=newGame({thinkTime:1000});storage.set('shogi-ai.current.v1',JSON.stringify(g));
  const saved=()=>JSON.parse(storage.get('shogi-ai.current.v1'));
  const originals={init:Engine.prototype.init,search:Engine.prototype.search,stop:Engine.prototype.stop,interval:globalThis.setInterval,now:Date.now};
  const descriptors=new Map(['document','window','navigator','localStorage','isSecureContext'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let now=100000,holdBg=true;const deferred=new Map();
  Engine.prototype.init=async function(){this.ready=true;};
  Engine.prototype.stop=function(){this.generation++;deferred.get(this)?.();deferred.delete(this);};
  Engine.prototype.search=async function(initial,moves,options){
    searches.push({moves:[...moves],options,background:this.hash===16});if(holdBg&&this.hash===16)await new Promise(r=>{deferred.set(this,r);});
    const p=positionAt(initial,moves),pv=[];for(let i=0;i<5;i++){const m=i===0&&!moves.length?p.createMoveByUSI('2g2f'):legalMoves(p)[0];if(!m)break;pv.push(m.usi);p.doMove(m);}
    return {bestmove:pv[0],infos:[{pv,rank:1,type:'cp',score:moves[0]==='7g7f'?600:10,bound:false,depth:5}]};
  };
  const globals={document:{getElementById:$,createElement:t=>new Element(t),createDocumentFragment:()=>new Element('#fragment'),querySelectorAll:()=>[],addEventListener(){},body:new Element('body')},window:{addEventListener(){}},navigator:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},isSecureContext:false};
  for(const [k,v]of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
  globalThis.setInterval=f=>{intervals.push(f);return 1;};Date.now=()=>now;
  const square=usi=>$('board').children.find(n=>n.dataset.square===usi);
  const play=async(from,to)=>{await square(from).click();await square(to).click();};
  try{
    await import('../dist/app.js');await $('start').click();await settle(()=>deferred.size>0);
    now+=2000;await play('7g','7f');await settle(()=>saved().moves.length===2);
    assert.equal(saved().moves[0],'7g7f');assert.equal(saved().moves.length,2);assert.equal(saved().teacherPending,null);assert.equal($('teacher-lesson').hidden,true);
    assert.equal($('pause').hidden,false,'the game stays running while the separate coach is busy');
    now+=5000;intervals[0]();assert.equal($('bottom-clock').textContent,'9:53');
    holdBg=false;for(const done of deferred.values())done();deferred.clear();
    await settle(()=>!$('teacher-notice').hidden);assert.match($('teacher-notice').textContent,/1手目/);
    assert.equal($('teacher-lesson').hidden,true,'even a warning does not force a modal lesson');
    now+=2000;intervals[0]();assert.equal($('bottom-clock').textContent,'9:51');
    await settle(()=>!$('teacher-check').disabled);const counted=searches.length;
    await $('teacher-check').click();assert.equal(searches.length,counted,'opening a finished review reuses it');
    assert.equal(saved().moves.length,2);assert.equal(saved().teacherPending.ply,1);assert.equal($('pause').hidden,true);
    const clocks=saved().clocks;now+=60000;intervals[0]();assert.equal($('bottom-clock').textContent,'9:51');
    await import('../dist/app.js?restore=1');
    assert.equal($('start').hidden,true);assert.equal($('teacher-reanalyze').hidden,false,'reload restores a lesson about an earlier move');
    await $('teacher-reanalyze').click();await settle(()=>!$('teacher-continue').disabled);
    const previewActual=[...saved().moves],card=$('teacher-reading').firstChild;
    assert.equal(card.querySelectorAll('div').find(n=>n.className==='reading-board').children.length,81,'searched future is visible as a complete board');
    const previewSelect=card.querySelector('select');previewSelect.value='best';previewSelect.onchange();
    assert.deepEqual(saved().moves,previewActual,'switching displayed continuations does not change the game');
    const attack=$('teacher-intents').children.find(n=>/攻め/.test(n.textContent));await attack.click();assert.equal($('teacher-intents').hidden,true);
    $('teacher-question').value='相手が3四歩なら？';await $('teacher-ask').onsubmit({preventDefault(){}});await settle(()=>!$('teacher-continue').disabled);
    assert(searches.some(c=>c.moves.join(' ')==='7g7f 3c3d'),'the requested opponent response is fixed before searching');
    const before=[...saved().moves];await $('teacher-look').click();assert.deepEqual(saved().moves,before);
    assert.match($('teacher-context').textContent,/検討 2手目/);assert(square('3d').children.some(n=>n.textContent==='歩'));
    const count=searches.length;$('teacher-question').value='ここから何を目指す？';await $('teacher-ask').onsubmit({preventDefault(){}});
    await settle(()=>!$('teacher-continue').disabled);assert.equal(searches[count].moves.length,2);assert.deepEqual(saved().moves,before);
    await $('teacher-origin').click();const opponents=searches.filter(c=>!c.background).length;
    await Promise.all([$('teacher-continue').click(),$('teacher-continue').click()]);
    assert.equal(saved().moves.length,2);assert.equal(saved().teacherPending,null);assert.equal(saved().teachingNotes[0].goal,'攻めを続けたい');
    assert.equal(searches.filter(c=>!c.background).length,opponents,'continuing at the human turn does not play the opponent twice');
    const full=saved();await $('undo').click();assert.equal(saved().moves.length,1);assert.equal(saved().redo.moves.length,2);
    await $('undo').click();assert.equal(saved().moves.length,0);await $('redo').click();await $('redo').click();
    assert.deepEqual(saved().moves,full.moves);assert.deepEqual(saved().clocks,full.clocks);
    await $('teacher-scan').click();await settle(()=>!$('teacher-scan').disabled);assert.match($('teacher-scan-status').textContent,/1手目から見直す/);
    await $('teacher-past-list').firstChild.click();assert.equal(saved().teacherPending.ply,1);
    await $('teacher-retry').click();assert.equal(saved().moves.length,0);assert(saved().variations.some(v=>v.moves.length===2));
    assert.equal($('pause').hidden,false);assert.equal($('teacher-lesson').hidden,true);
    // Switching games while a coach is reading invalidates all delayed results.
    holdBg=true;await play('7g','7f');await settle(()=>deferred.size>0);
    $('opening').value='standard';$('human-side').value='black';$('clock-mode').value='match';await $('new-game').click();holdBg=false;
    await settle(()=>$('teacher-lesson').hidden);assert.deepEqual(saved().moves,[]);assert.equal($('teacher-notice').hidden,true);
    const bgCalls=searches.filter(c=>c.background).length;
    await $('start').click();await play('7g','7f');await settle(()=>saved().moves.length===2);
    assert.equal(searches.filter(c=>c.background).length,bgCalls,'match mode has no background assistance');
    assert.equal(saved().teacherPending,null);assert.equal(clocks.black,591000);
  }finally{
    Engine.prototype.init=originals.init;Engine.prototype.search=originals.search;Engine.prototype.stop=originals.stop;globalThis.setInterval=originals.interval;Date.now=originals.now;
    for(const[k,d]of descriptors)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];
  }
});
