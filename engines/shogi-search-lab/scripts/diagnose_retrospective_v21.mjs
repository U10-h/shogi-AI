// Post-hoc depth sensitivity only; this does not change frozen test selection.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {ROOT,START,yaneura} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
const D=process.env.V21_RESULTS||ROOT+'/results/retrospective-20260927',read=p=>JSON.parse(readFileSync(p));
const ids=['0-44','7-44','4-44','7-28','3-60','3-28','4-28'];
const protocol={kind:'post-hoc sensitivity diagnostic',ids,depth:16,selection:'Three largest latest-versus-capture improvements at 3s (0-44,7-44,4-44); largest worsening at 3s (7-28); both changes from latest 3s to 5s (3-60,3-28); 0.3s-to-1s deterioration (4-28). Chosen after depth-12 results; not an independent test.',notes:['Same common candidate set as depth 12; no new moves or model tuning.','A deeper teacher is still an approximation, and shares the original NNUE.']};
mkdirSync(D+'/depth16',{recursive:true});if(!existsSync(D+'/depth16/protocol.json'))writeFileSync(D+'/depth16/protocol.json',JSON.stringify(protocol,null,2));
const t=await yaneura(D+'/depth16/usi.jsonl',{allLegalMoves:true});
try{for(const id of ids){
 const path=D+'/depth16/'+id+'.json';if(existsSync(path))continue;
 const prior=read(D+'/teacher/'+id+'.json'),moves=prior.candidates.map(c=>c.move);
 await t.reset();const response=await t.search(prior.root.prefix,{depth:16,multipv:moves.length,searchmoves:moves});
 const found=new Map();for(const x of response.infos)if(!x.bound&&x.depth>=16&&moves.includes(x.pv[0]))found.set(x.pv[0],x);
 if(found.size!==moves.length)throw Error('Incomplete depth16 '+id);
 for(const x of found.values())if(checkedPV(recordAt(START,prior.root.prefix).position,x.pv).length!==x.pv.length)throw Error('Illegal PV');
 writeFileSync(path,JSON.stringify({root:prior.root,candidates:[...found].map(([move,x])=>({move,...x})),priorCandidates:prior.candidates,response}));console.log(id);
}}finally{t.close();}
