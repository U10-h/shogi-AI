import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Coach} from '../dist/coach-ui.js';
import {START,positionAt,legalMoves} from '../dist/core.js';

// Minimal DOM adapter exercises the actual controller with a deterministic USI
// fixture. Real engine integration lives separately in engine-smoke.mjs.
class Node {
 constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.textContent='';this.dataset={};}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 get firstChild(){return this.children[0];}
 remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
 querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)]);}
 focus(){}
 setAttribute(name,value){this[name]=value;}
}
function fixture(){
 const ids=[...readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const nodes=new Map(ids.map(id=>[id,new Node()]));
 globalThis.document={getElementById:id=>{assert(nodes.has(id),'Missing element '+id);return nodes.get(id);},createElement:tag=>new Node(tag),querySelectorAll:()=>[]};
 const game={initial:START,moves:[]};let visible=structuredClone(game),coach;const searches=[];
 const engine={stop(){},async search(initial,moves){searches.push([...moves]);const p=positionAt(initial,moves),pv=[];for(let i=0;i<4;i++){const m=legalMoves(p)[0];if(!m)break;pv.push(m.usi);p.doMove(m);}return {infos:[{pv,type:'cp',score:20,rank:1,bound:false,depth:6}]};}};
 const bridge={current:()=>visible,time:()=>1000,prepare:async()=>{},refresh:()=>coach.sync({root:visible,gameId:'game1',allowed:true}),cancelPick(){},pick:r=>{visible=structuredClone(r);},showLine:async(r,pv,ply)=>{visible={initial:r.initial,moves:[...r.moves,...pv.slice(0,ply)]};bridge.refresh();},run:async task=>task(()=>{})};
 coach=new Coach(bridge,engine);bridge.refresh();return {coach,bridge,game,nodes,searches,get visible(){return visible;}};
}
test('follow-up questions use the new board; back restores the original dialogue, candidate and notes',async()=>{
 const f=fixture(),c=f.coach;
 f.nodes.get('coach-hope').value='歩を交換したい';
 await c.ask('嬉しい展開と困る展開は？');
 assert.equal(c.notes().hope,'歩を交換したい','first adoption must retain the learner draft');
 const original=c.snapshot(),branch=c.report.defense;
 await c.follow(branch);
 assert.equal(c.root.moves.length,2);assert.equal(f.visible.moves.length,2);assert.equal(c.report,null);
 assert.equal(c.trail.length,1);assert.equal(c.notes().hope,'');assert.equal(c.learnerSide,original.learnerSide);
 assert(c.history.some(x=>/歩を交換したい/.test(x.text)),'earlier intention survives into follow-up context');
 f.nodes.get('coach-worry').value='王手をかけられると困る';
 const candidate=legalMoves(positionAt(c.root.initial,c.root.moves))[1].usi;
 const before=f.searches.length;await c.ask(candidate+'はどう？');
 assert.deepEqual(f.searches[before],branch.pv.slice(0,2));assert.equal(c.report.chosen,candidate);
 await c.follow(c.report.defense);assert.equal(c.root.moves.length,4);
 await c.back();assert.equal(c.root.moves.length,2);assert.equal(c.notes().worry,'王手をかけられると困る');
 await c.back();assert.deepEqual(c.snapshot(),original);assert.deepEqual(f.visible.moves,[]);assert.deepEqual(f.game.moves,[]);
});
test('manual one-ply consultation preserves the learner viewpoint and new games discard the trail',async()=>{
 const f=fixture(),c=f.coach;await c.ask('7g7fはどう？');
 await f.bridge.showLine(c.root,c.report.defense.pv,1);await c.adopt();
 assert.equal(positionAt(c.root.initial,c.root.moves).color,'white');assert.equal(c.learnerSide,'black');
 assert.equal(c.trail.length,1);c.sync({root:{initial:START,moves:[]},gameId:'game2',allowed:true});
 assert.equal(c.root,null);assert.equal(c.trail.length,0);assert.equal(c.notes().hope,'');assert.equal(c.learnerSide,null);
});
test('asking about two plies offers branch choices without silently changing the board',async()=>{
 const f=fixture(),c=f.coach;await c.ask('7g7fはどう？');const root=structuredClone(c.root);
 const count=f.searches.length;await c.ask('2手先では？');assert.equal(f.searches.length,count);
 assert.deepEqual(c.root,root);assert.match(c.history.at(-1).text,/どの読み筋/);assert.equal(c.working,false);
 const buttons=f.nodes.get('coach-chat').querySelectorAll('button');assert(buttons.length>0);assert(!buttons.at(-1).disabled);
 await buttons.at(-1).onclick();assert.equal(c.root.moves.length,2);
});
test('outlooks retain the game human side and carry an unsubmitted forecast into the next consultation',async()=>{
 const f=fixture(),c=f.coach;f.bridge.learnerSide=()=> 'white';await c.ask('最善手は？');
 assert.equal(c.learnerSide,'white');assert.equal(c.report.side,'black');
 f.nodes.get('coach-hope').value='飛車を働かせたい';await c.follow(c.report.defense);
 assert.equal(c.learnerSide,'white');assert(c.history.some(x=>/未検証/.test(x.text)&&/飛車を働かせたい/.test(x.text)));
});
test('a one-move line never enables the two-ply continuation control',async()=>{
 const f=fixture(),c=f.coach;await c.ask('最善手は？');
 c.report.defense.pv=c.report.defense.pv.slice(0,1);c.report.defense.evidence.moves=c.report.defense.evidence.moves.slice(0,1);
 c.drawReport();c.controls();const button=f.nodes.get('coach-report').querySelectorAll('button').find(b=>b.textContent==='この2手の先を相談');
 assert.equal(button.disabled,true);await c.ask('2手先では？');assert.match(c.history.at(-1).text,/2手分の続きがありません/);
});
test('the report shows one branch at a time while preserving access to the alternatives',async()=>{
 const f=fixture(),c=f.coach;await c.ask('7g7fはどう？');
 const box=f.nodes.get('coach-report');assert.equal(box.querySelectorAll('button').filter(b=>b.textContent==='この2手の先を相談').length,1);
 const select=box.querySelectorAll('select')[0];assert(select.children.length>=2);select.value='best';select.onchange();
 assert.equal(c.activeBranch,'best');assert.deepEqual(c.root.moves,[]);
 assert.equal(box.querySelectorAll('button').filter(b=>b.textContent==='この2手の先を相談').length,1);
});
