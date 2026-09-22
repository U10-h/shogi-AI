import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ROOT,BIN,ASSETS,lab} from './arena_lib.mjs';
import {Position,Square,Piece,reverseColor} from '../vendor/tsshogi/index.js';
const D=ROOT+'/results/v0.14',model=ROOT+'/models/v0.14/quiet-policy.txt';
const read=p=>JSON.parse(readFileSync(p));
const rows=read(D+'/policy-validation-positions.json').filter((_,i)=>i%47===0);
const weights=readFileSync(model,'utf8').trim().split('\n')[1].split(' ').map(Number);
const dump=spawnSync(BIN,['--policy-dump','--policy-model',model],{input:rows.map(r=>r.sfen).join('\n')+'\n',encoding:'utf8',maxBuffer:100e6});
if(dump.status!==0)throw Error(dump.stderr);
const outputs=dump.stdout.trim().split('\n').map(JSON.parse);
const types=['','pawn','lance','knight','silver','bishop','rook','gold','king','promPawn','promLance','promKnight','promSilver','horse','dragon'];
let checked=0;
for(let i=0;i<outputs.length;i++){
 const p=Position.newBySFEN(rows[i].sfen),side=p.color;
 const orient=s=>{let n=(s.file-1)*9+s.rank-1;return side==='black'?n:80-n;};
 const king=c=>orient(p.board.listSquaresByPiece(new Piece(c,'king'))[0]);
 const delta=(a,b)=>(Math.floor(a/9)-Math.floor(b/9)+8)*17+(a%9-b%9+8);
 for(const row of outputs[i].moves){
  const m=p.createMoveByUSI(row.move);if(!p.isValidMove(m))throw Error('illegal');
  const drop=typeof m.from==='string',pt=types.indexOf(m.pieceType)+(drop?16:0),to=orient(m.to),from=drop?81:orient(m.from);
  const copy=p.clone();copy.doMove(m);
  const attackers=p.listAttackers(m.to),count=c=>Math.min(3,attackers.filter(s=>p.board.at(s).color===c).length);
  const ids=[pt*81+to,1944+pt*82+from,3912+pt*289+(drop?144:delta(to,from)),10848+pt*16+Math.max(0,types.indexOf(p.board.at(m.to)?.type)),11232+pt*289+delta(to,king(reverseColor(side))),18168+pt*289+delta(to,king(side)),25104+pt*2+Number(m.promote),25152+pt*2+Number(copy.checked),25200+pt*4+count(reverseColor(side)),25296+pt*4+count(side)];
  if(JSON.stringify(ids)!==JSON.stringify(row.ids))throw Error(JSON.stringify({sfen:rows[i].sfen,move:row.move,ids,actual:row.ids}));
  if(ids.reduce((s,id)=>s+weights[id],0)!==row.score)throw Error('score mismatch');checked++;
 }
}
const roots=read(ROOT+'/results/v0.13/roots.json').slice(0,12),fields=['score','pv','nodes','completed_depth','has_result','stop_reason','bestmove','stats','fallback_move','fallback_pv'];
let parity=0;
for(const root of roots){
 const args=['--advanced','--preset','tactical','--eval','nnue','--eval-model',ASSETS+'/yaneuraou.data','--depth','16','--iterative','--max-nodes','12000'];
 const old=await lab(root.prefix,args,undefined,ROOT+'/build/shogi-lab-v0.13'),now=await lab(root.prefix,args),zero=await lab(root.prefix,[...args,'--policy-model',model,'--policy-scale','0']);
 for(const f of fields)if(JSON.stringify(old[f])!==JSON.stringify(now[f])||JSON.stringify(now[f])!==JSON.stringify(zero[f]))throw Error('baseline parity '+root.game+' '+f);
 parity++;
}
const result={independentFeaturePositions:rows.length,independentFeatureMoves:checked,independentIntegerInference:checked,baselineAndZeroScaleSearches:parity,fields};
writeFileSync(D+'/verification.json',JSON.stringify(result,null,2)+'\n');console.log(result);
