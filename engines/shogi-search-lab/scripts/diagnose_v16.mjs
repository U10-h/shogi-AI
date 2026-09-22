// Post-hoc failure snapshots. First >500cp disadvantage seen by the opponent,
// then rescore the preceding candidate move against a depth-14 alternative.
import {readFileSync,writeFileSync}from'node:fs';
import {ROOT,START,yaneura}from'./arena_lib.mjs';
import {recordAt,checkedPV,moveLabel}from'./record_helpers.mjs';
const D=ROOT+'/results/v0.16',read=p=>JSON.parse(readFileSync(p)),teacher=await yaneura(undefined,{allLegalMoves:true}),rows=[];
try{for(const name of ['baseline','adaptive','blend','clipped']){
 const g=read(D+'/matches/0-black-'+name+'.json');
 const index=g.moves.findIndex((m,i)=>i>0&&m.variant==='yaneuraou'&&m.analysis.info?.type==='cp'&&m.analysis.info.score>500&&m.analysis.info.score<=30000);
 if(index<1){rows.push({variant:name,found:false});continue;}
 const previous=g.moves[index-1],prefix=[...g.opening,...g.moves.slice(0,index-1).map(m=>m.usi)],position=recordAt(START,prefix).position;
 await teacher.reset();const best=await teacher.search(prefix,{depth:14}),moves=[...new Set([previous.usi,best.move])];await teacher.reset();
 const analysis=await teacher.search(prefix,{depth:14,multipv:moves.length,searchmoves:moves}),found=new Map();
 for(const x of analysis.infos)if(!x.bound&&moves.includes(x.pv[0]))found.set(x.pv[0],x);
 if(found.size!==moves.length)throw Error('Incomplete diagnostic scores');
 const candidates=moves.map(move=>({move,label:moveLabel(position,move),...found.get(move)}));
 for(const x of candidates)if(checkedPV(position,x.pv).length!==x.pv.length)throw Error('Invalid diagnostic PV');
 rows.push({variant:name,found:true,selection:'first opponent cp>500, post-hoc illustrative only',ply:previous.ply,sfen:position.sfen,prefix,played:previous.usi,playedLabel:moveLabel(position,previous.usi),best,analysis,candidates});
 console.log(JSON.stringify({name,ply:previous.ply,candidates:candidates.map(c=>[c.label,c.type,c.score])}));
}}finally{teacher.close();}
writeFileSync(D+'/failure-diagnosis.json',JSON.stringify(rows,null,2)+'\n');
