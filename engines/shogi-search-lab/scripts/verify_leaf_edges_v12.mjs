// Independently validate qsearch edges, captures/promotions, and completion paths.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {ROOT} from './arena_lib.mjs';
import {recordAt,checkedPV} from './record_helpers.mjs';
const D=ROOT+'/results/v0.12/traces';let nodes=0,edges=0,pvs=0,captures=0,promotions=0,drops=0;
const key=s=>s.split(' ').slice(0,3).join(' ');
for(const f of readdirSync(D).filter(p=>p.endsWith('.jsonl'))){
 const events=readFileSync(D+'/'+f,'utf8').trim().split('\n').map(JSON.parse),lookup=new Map();
 for(const e of events){
  if(e.event==='qeval'||!lookup.has(e.node))lookup.set(e.node,e);
  const p=recordAt(e.sfen,[]).position;
  if(p.checked!==e.checked)throw Error('Check mismatch');
  if(e.event==='qreturn'){
   if(checkedPV(p,e.pv).length!==e.pv.length)throw Error('Illegal return PV');pvs+=e.pv.length;
  }
 }
 for(const e of lookup.values()){
  nodes++;
  if(!e.parent_qnode)continue;
  const parent=lookup.get(e.parent_qnode);if(!parent)throw Error('Missing parent');
  const before=recordAt(parent.sfen,[]).position,m=before.createMoveByUSI(e.incoming);
  if(!m||!before.isValidMove(m))throw Error('Illegal edge');
  captures+=Boolean(before.board.at(m.to));promotions+=e.incoming.endsWith('+');drops+=e.incoming.includes('*');
  const after=recordAt(parent.sfen,[e.incoming]).position;
  if(key(after.sfen)!==key(e.sfen)||e.ply!==parent.ply+1||e.qleft!==parent.qleft-1)throw Error('Child mismatch');edges++;
 }
}
const out={nodes,edges,pvMoves:pvs,captures,promotions,drops,independentRules:'tsshogi',allValid:true};
writeFileSync(ROOT+'/results/v0.12/leaf-edge-validation.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
