// Independent replay with tsshogi. Requires completed experiments; no new searches.
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {ROOT,START} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,parseRecord} from './record_helpers.mjs';
const D=ROOT+'/results/v0.17',read=p=>JSON.parse(readFileSync(p));
let games=0,moves=0,pvs=0,searches=0,teacherMoves=0;
const norm=s=>s.split(' ').slice(0,3).join(' ');
for(const dir of ['matches','selfplay'])for(const file of readdirSync(D+'/'+dir).filter(f=>f.endsWith('.json'))){
 const g=read(D+'/'+dir+'/'+file);if(g.status!=='finished')throw Error('Unfinished '+file);
 const prefix=[...g.opening];
 for(const m of dir==='matches'?g.moves:g.rows){
  const rec=recordAt(START,prefix),before=dir==='matches'?m.beforeSfen:m.sfen;
  if(norm(before)!==norm(rec.position.sfen))throw Error('Before SFEN mismatch');
  let pv;
  if(dir==='matches')pv=m.variant==='yaneuraou'?m.analysis.info?.pv:m.analysis.has_result?m.analysis.pv:m.analysis.fallback_pv;
  else pv=m.analysis.info?.pv;
  if(pv){if(checkedPV(rec.position,pv).length!==pv.length)throw Error('Illegal PV');pvs+=pv.length;}
  prefix.push(dir==='matches'?m.usi:m.move);const after=recordAt(START,prefix);
  if(dir==='matches'&&norm(after.position.sfen)!==norm(m.afterSfen))throw Error('After SFEN mismatch');
  ++moves;if(dir==='selfplay')++teacherMoves;
 }
 if(!g.result.unresolved&&['checkmate','no-legal-move'].includes(g.result.reason)&&hasLegalMove(recordAt(START,prefix).position))throw Error('Terminal mismatch');
 const kif=parseRecord(readFileSync(D+'/'+dir+'/'+file.replace('.json','.kif'),'utf8'));
 if(JSON.stringify(kif.moves)!==JSON.stringify(prefix))throw Error('KIF mismatch');++games;
}
for(const dir of ['dev','test'])for(const file of readdirSync(D+'/'+dir).filter(f=>f.endsWith('.json'))){
 const row=read(D+'/'+dir+'/'+file),position=recordAt(START,row.root.prefix).position;
 if(norm(position.sfen)!==norm(row.root.sfen))throw Error('Root SFEN mismatch');
 for(const r of row.runs){
  const pv=r.has_result?r.pv:r.fallback_pv;
  if(!pv.length||pv[0]!==r.chosenMove||checkedPV(position,pv).length!==pv.length)throw Error('Illegal quality PV');
  ++searches;pvs+=pv.length;
 }
}
for(const file of ['fallback-replay.json','long-fallback.json'])for(const row of read(D+'/'+file).rows){
 const a=row.analysis,pv=a.has_result?a.pv:a.fallback_pv;
 if(!pv.length||checkedPV(recordAt(START,row.prefix).position,pv).length!==pv.length)throw Error('Illegal diagnostic PV');++searches;pvs+=pv.length;
}
if(games!==26||searches!==394)throw Error('Expected 26 games and 394 searches, got '+games+' / '+searches);
writeFileSync(D+'/audit.json',JSON.stringify({passed:true,games,moves,teacherMoves,pvPlies:pvs,searches,rules:'Independent tsshogi replay, SFEN, legal PV, terminal, KIF roundtrip'},null,2)+'\n');console.log(JSON.stringify({passed:true,games,moves,pvs,searches}));
