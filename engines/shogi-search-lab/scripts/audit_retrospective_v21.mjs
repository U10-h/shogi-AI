// Final independent replay, terminal-state audit, and immutable-file manifest.
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ROOT,START} from './arena_lib.mjs';
import {recordAt,checkedPV,hasLegalMove,parseRecord} from './record_helpers.mjs';
const D=process.env.V21_RESULTS||ROOT+'/results/retrospective-20260927';
const read=p=>JSON.parse(readFileSync(p)),other=c=>c==='black'?'white':'black';
const counts={games:0,gameMoves:0,gamePvPlies:0,searches:0,searchPvPlies:0,teacherRoots:0,teacherPvPlies:0,diagnosticRoots:0,diagnosticPvPlies:0,kifRoundTrips:0};
for(const f of readdirSync(D+'/matches').filter(f=>f.endsWith('.json'))){
 const g=read(D+'/matches/'+f);if(g.status!=='finished')throw Error('Unfinished '+g.id);
 const r=recordAt(START,g.opening.prefix),prefix=[...g.opening.prefix];
 for(const m of g.moves){
  const a=m.analysis,pv=m.variant==='yaneuraou'?a.info?.pv:(a.has_result?a.pv:a.fallback_pv);
  if(pv&&checkedPV(r.position,pv).length!==pv.length)throw Error('Bad PV');counts.gamePvPlies+=pv?.length||0;
  if(m.side!==r.position.color)throw Error('Color mismatch');
  const move=r.position.createMoveByUSI(m.usi);if(!move||!r.position.isValidMove(move)||!r.append(move))throw Error('Bad move');
  if(r.position.sfen.split(' ').slice(0,3).join(' ')!==m.afterSfen.split(' ').slice(0,3).join(' '))throw Error('SFEN mismatch');
  prefix.push(m.usi);counts.gameMoves++;
 }
 const result=g.result;
 if(['checkmate','no-legal-move'].includes(result.reason)){if(hasLegalMove(r.position)||result.winner!==other(r.position.color))throw Error('Terminal mismatch');}
 if(result.reason==='repetition'&&(!r.repetition||r.perpetualCheck!==null))throw Error('Repetition mismatch');
 if(result.reason==='perpetual-check'&&(!r.repetition||r.perpetualCheck===null||result.winner!==other(r.perpetualCheck)))throw Error('Perpetual-check mismatch');
 if(result.reason==='move-limit'&&(!result.unresolved||g.moves.length!==200))throw Error('Limit mismatch');
 const parsed=parseRecord(readFileSync(D+'/matches/'+f.replace('.json','.kif'),'utf8'));
 if(JSON.stringify(parsed.moves)!==JSON.stringify(prefix))throw Error('KIF mismatch');counts.kifRoundTrips++;counts.games++;
}
for(const dir of ['quality','speed','hard'])for(const f of readdirSync(D+'/'+dir).filter(f=>f.endsWith('.json'))){
 const d=read(D+'/'+dir+'/'+f),r=recordAt(START,d.root.prefix);
 for(const a of d.runs){const pv=a.has_result?a.pv:a.fallback_pv;if(checkedPV(r.position,pv).length!==pv.length)throw Error('Search PV');counts.searches++;counts.searchPvPlies+=pv.length;}
}
for(const f of readdirSync(D+'/teacher').filter(f=>f.endsWith('.json'))){
 const d=read(D+'/teacher/'+f),r=recordAt(START,d.root.prefix);
 for(const c of d.candidates){if(checkedPV(r.position,c.pv).length!==c.pv.length)throw Error('Teacher PV');counts.teacherPvPlies+=c.pv.length;}counts.teacherRoots++;
}
for(const f of readdirSync(D+'/depth16').filter(f=>f.endsWith('.json')&&f!=='protocol.json')){
 const d=read(D+'/depth16/'+f);if(!d.root||!d.candidates)continue;
 const r=recordAt(START,d.root.prefix);
 for(const c of d.candidates){if(checkedPV(r.position,c.pv).length!==c.pv.length)throw Error('Diagnostic PV');counts.diagnosticPvPlies+=c.pv.length;}counts.diagnosticRoots++;
}
if(counts.games!==48||counts.searches!==660||counts.teacherRoots!==24||counts.diagnosticRoots!==7)throw Error('Missing experiments '+JSON.stringify(counts));
const audit={passed:true,counts,terminalImplementation:'vendored tsshogi record repetition/perpetualCheck plus independent legal-move existence',source:'4f94f7baf775c4c3870e5d9863536305b4902deb'};
writeFileSync(D+'/audit.json',JSON.stringify(audit,null,2)+'\n');
const files=[];function walk(dir){for(const f of readdirSync(dir).sort()){const p=dir+'/'+f;if(statSync(p).isDirectory())walk(p);else if(!p.endsWith('/manifest.json')&&!p.endsWith('/raw-results.tar.gz'))files.push({path:p.slice(D.length+1),bytes:statSync(p).size,sha256:createHash('sha256').update(readFileSync(p)).digest('hex')});}}walk(D);
writeFileSync(D+'/manifest.json',JSON.stringify({files},null,2)+'\n');console.log(JSON.stringify(audit));
