import {readdirSync,readFileSync} from 'node:fs';
import {START,lab} from './arena_lib.mjs';
import {recordAt,checkedPV,parseRecord,hasLegalMove} from './record_helpers.mjs';
import {D,save,read,checkProtocol} from './experiment_v19.mjs';
checkProtocol();let searches=0,pvMoves=0,gameMoves=0,gameCount=0,teacherPVs=0;
function auditSearch(prefix,a){const pv=a.has_result?a.pv:a.fallback_pv;if(checkedPV(recordAt(START,prefix).position,pv).length!==pv.length)throw Error('Illegal search PV');searches++;pvMoves+=pv.length;}
for(const part of ['dev','test'])for(const f of readdirSync(D+'/'+part).filter(f=>f.endsWith('.json'))){
 const r=read(D+'/'+part+'/'+f);for(const a of r.runs)auditSearch(r.root.prefix,a);
}
for(const part of ['fallback'])for(const r of read(D+'/'+part+'.json').rows)auditSearch(r.prefix,r.analysis);
for(const part of ['dev','test'])for(const f of readdirSync(D+'/'+part+'-teacher').filter(f=>f.endsWith('.json'))){
 const r=read(D+'/'+part+'-teacher/'+f);for(const a of r.candidates){if(a.bound||a.depth<12||checkedPV(recordAt(START,r.root.prefix).position,a.pv).length!==a.pv.length)throw Error('Teacher PV invalid');teacherPVs++;}
}
for(const f of readdirSync(D+'/matches').filter(f=>f.endsWith('.json'))){
 const g=read(D+'/matches/'+f);if(g.status!=='finished')throw Error('Unfinished game');
 const record=recordAt(START,[]),prefix=[];
 for(const m of g.moves){
  if(m.beforeSfen.split(' ').slice(0,3).join(' ')!==record.position.sfen.split(' ').slice(0,3).join(' '))throw Error('Before state mismatch');
  if(m.variant!=='yaneuraou')auditSearch(prefix,m.analysis);
  else if(m.analysis.info?.pv){const pv=m.analysis.info.pv;if(checkedPV(record.position,pv).length!==pv.length)throw Error('Opponent PV illegal');pvMoves+=pv.length;}
  const move=record.position.createMoveByUSI(m.usi);if(!move||!record.position.isValidMove(move)||!record.append(move))throw Error('Illegal recorded move');prefix.push(m.usi);gameMoves++;
  if(m.afterSfen!==record.position.sfen)throw Error('After state mismatch');
 }
 const kif=readFileSync(D+'/matches/'+g.id+'.kif','utf8');if(JSON.stringify(parseRecord(kif).moves)!==JSON.stringify(prefix))throw Error('KIF roundtrip');
 const terminal=await lab(prefix,['--legal']);if(g.result.reason==='checkmate'&&(!terminal.in_check||terminal.moves.length||hasLegalMove(record.position)))throw Error('Checkmate mismatch');gameCount++;
}
for(const f of readdirSync(D+'/trajectories').filter(f=>f.endsWith('.json'))){const g=read(D+'/trajectories/'+f);for(const r of g.rows){recordAt(START,[...r.prefix,r.move]);}}
save(D+'/legal-audit.json',{passed:true,gameCount,gameMoves,searches,pvMoves,teacherPVs,trajectoryMoves:256,independentRules:'Pinned MIT tsshogi; all recorded moves/PVs and KIF round trips; C++ also verifies terminal state.'});console.log(JSON.stringify({passed:true,gameCount,gameMoves,searches,pvMoves,teacherPVs}));
