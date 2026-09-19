import {writeFileSync} from 'node:fs';
import {createNNUE} from './nnue-adapter.mjs';
import {START,GOKIGEN,positionAt,checkedPV,statusOf} from '../dist/core.js';
const engine=await createNNUE(),positions=[],moves=[...GOKIGEN];
try{
  for(let n=moves.length;n<=64;n++){
    if([6,20,36,52,64].includes(n))positions.push({id:'gokigen-'+n,initial:START,moves:[...moves]});
    if(n===64||statusOf(START,moves))break;
    const r=await engine.search(START,moves,{time:100,multipv:1});
    if(!checkedPV(positionAt(START,moves),[r.bestmove]).length)throw Error('Invalid selfplay');moves.push(r.bestmove);
  }
  for(const p of positions){await engine.reset();const ref=await engine.search(p.initial,p.moves,{time:2500,multipv:5});p.reference=ref;p.chosen=ref.infos[Math.min(2,ref.infos.length-1)].pv[0];console.log(p.id,ref.bestmove,ref.infos[0]?.depth);}
  writeFileSync(new URL('../docs/experiments/positions.json',import.meta.url),JSON.stringify({description:'Locally generated legal selfplay. 2.5 s MultiPV 5 reference, not ground truth; first three tuning, last two held out.',positions},null,2));
}finally{engine.terminate();}
