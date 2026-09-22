// Post-hoc replay of six late-game first-iteration failures, same roots/budget.
import {readFileSync,writeFileSync}from'node:fs';
import {ROOT,START,ASSETS,BIN,lab,hash}from'./arena_lib.mjs';
import {recordAt,checkedPV}from'./record_helpers.mjs';
const D=ROOT+'/results/v0.16',read=p=>JSON.parse(readFileSync(p)),g=read(D+'/matches/1-black-blend.json'),cases=g.moves.filter(m=>m.variant==='blend'&&!m.analysis.has_result),rows=[];
const names=['baseline','adaptive','blend','clipped'],evals={baseline:'nnue',adaptive:'nnue',blend:'nnue-blend25',clipped:'nnue-clipped'};
for(let i=0;i<cases.length;i++){
 const entry=cases[i],prefix=[...g.opening,...g.moves.filter(m=>m.ply<entry.ply).map(m=>m.usi)],position=recordAt(START,prefix).position;
 for(let j=0;j<names.length;j++){
  const name=names[(i+j)%names.length],args=['--advanced','--eval',evals[name],'--eval-model',ASSETS+'/yaneuraou.data','--features','tt,history,killer,counter,mate-distance,qsearch,capture-history','--max-nodes','1000000000','--time-ms','1000'];
  if(name==='baseline')args.push('--depth','16','--iterative');else args.push('--driver','adaptive');
  if(name==='blend'||name==='clipped')args.push('--eval-head',ROOT+'/models/v0.16/pair100-head.txt');
  const r=await lab(prefix,args),pv=r.has_result?r.pv:r.fallback_pv;
  if(!pv.length||checkedPV(position,pv).length!==pv.length)throw Error('Illegal replay PV');
  rows.push({ply:entry.ply,prefix,variant:name,analysis:r});console.log(JSON.stringify({ply:entry.ply,name,completed:r.has_result,iteration:r.completed_depth,rootChildren:r.completed_root_moves,nodes:r.nodes}));
 }
}
writeFileSync(D+'/fallback-replay.json',JSON.stringify({selection:'post-hoc six first-iteration failures from one game later lost; not independent test data',binarySha256:hash(BIN),ms:1000,rows},null,2)+'\n');
