// Independent tsshogi replay of every result, PV, termination and KIF.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {ROOT,START,hash} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,parseRecord} from './record_helpers.mjs';
const D=process.env.V16_RESULTS||ROOT+'/results/v0.16',read=p=>JSON.parse(readFileSync(p));
const boardKey=s=>s.split(' ').slice(0,3).join(' ');
const p=read(D+'/protocol.json'),out={qualitySearches:0,qualityPVPlies:0,games:0,moves:0,matchPVPlies:0,results:[]},other=c=>c==='black'?'white':'black';
for(const file of readdirSync(D+'/quality').filter(x=>x.endsWith('.json'))){
 const x=read(D+'/quality/'+file),position=recordAt(START,x.root.prefix).position;
 if(position.sfen!==x.root.sfen)throw Error('Root history mismatch');
 for(const r of x.runs){const pv=r.has_result?r.pv:r.fallback_pv;if(!pv.length||pv[0]!==r.chosenMove||checkedPV(position,pv).length!==pv.length)throw Error('Invalid quality PV');out.qualitySearches++;out.qualityPVPlies+=pv.length;}
}
if(out.qualitySearches!==p.roots*p.names.length*p.quality.ms.length*p.quality.repeats)throw Error('Incomplete quality');
for(const file of readdirSync(D+'/matches').filter(x=>x.endsWith('.json'))){
 const g=read(D+'/matches/'+file);if(g.status!=='finished')throw Error('Incomplete game');
 const r=recordAt(START,g.opening);
 for(const m of g.moves){
  if(r.repetition||!hasLegalMove(r.position))throw Error('Continued terminal game');
  // tsshogi formats the SFEN move number as 1; lab retains the actual ply.
  if(boardKey(r.position.sfen)!==boardKey(m.beforeSfen)||Number(m.beforeSfen.split(' ')[3])!==m.ply)throw Error('Before board/ply mismatch');
  const own=m.variant!=='yaneuraou',pv=own?(m.analysis.has_result?m.analysis.pv:m.analysis.fallback_pv):m.analysis.info?.pv;
  if(pv&&checkedPV(r.position,pv).length!==pv.length)throw Error('Illegal PV');
  if(pv?.[0]!==m.usi)throw Error('Played move and PV differ');out.matchPVPlies+=pv?.length||0;
  const move=r.position.createMoveByUSI(m.usi);if(!move||!r.position.isValidMove(move)||!r.append(move))throw Error('Illegal played move');
  if(r.position.sfen!==m.afterSfen)throw Error('After SFEN mismatch');out.moves++;
 }
 const res=g.result,legal=hasLegalMove(r.position);
 if(res.reason==='checkmate'||res.reason==='no-legal-move'){if(legal||res.winner!==other(r.position.color)||r.position.checked!==(res.reason==='checkmate'))throw Error('Wrong terminal outcome');}
 else if(res.reason==='repetition'||res.reason==='perpetual-check'){if(!r.repetition||(r.perpetualCheck===null?null:other(r.perpetualCheck))!==res.winner)throw Error('Wrong repetition outcome');}
 else if(res.reason==='move-limit'){if(!res.unresolved||g.moves.length!==p.matches.maxPlies||!legal||r.repetition)throw Error('Wrong unresolved outcome');}
 else if(res.reason==='resign'){if(res.winner!==g.candidateSide||r.position.color===g.candidateSide)throw Error('Unexpected resign');}
 else throw Error('Unknown terminal reason');
 const expected=[...g.opening,...g.moves.map(m=>m.usi)],kif=parseRecord(readFileSync(D+'/matches/'+g.id+'.kif','utf8'));
 if(JSON.stringify(kif.moves)!==JSON.stringify(expected))throw Error('KIF roundtrip mismatch');
 out.games++;out.results.push({id:g.id,result:res,sha256:hash(D+'/matches/'+file)});
}
if(out.games!==p.matches.variants.length*p.matches.openings.length*p.matches.colors.length)throw Error('Incomplete game count');
writeFileSync(D+'/independent-audit.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
