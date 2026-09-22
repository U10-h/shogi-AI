import {positionAt,checkedPV} from './core.js';

export const SEARCH_POLICY=Object.freeze({revision:15,cacheEntries:48,cacheBytes:524288,pvInterval:200,consideration:true,efficientDeep:true,probeRatio:0.8,candidateLimit:4,candidateWindow:180,focusPool:4.5,tacticalPool:6,replyRatio:1,recheckContradiction:true,reuseWarm:true,widenGap:100});
export function focusPool(r,policy){
  if(!policy?.tacticalPool)return policy?.focusPool;
  for(const line of r.ranking.slice(0,2)){
    if(line.bound||line.type==='mate')return policy.tacticalPool;
    const p=positionAt(r.root.initial,r.root.moves);
    for(const usi of line.pv.slice(0,3)){
      const m=p.createMoveByUSI(usi);if(!m||!p.isValidMove(m))break;
      if(p.checked||m.capturedPieceType||m.promote)return policy.tacticalPool;
      p.doMove(m);if(p.checked)return policy.tacticalPool;
    }
  }
  return policy.focusPool;
}
export function candidateFrontier(r,policy){
  if(!policy?.candidateLimit)return [...new Set([r.bestMove,r.chosen,...r.ranking.slice(0,3).map(x=>x.pv[0])])];
  const first=r.ranking[0],near=r.ranking.filter((x,i)=>i<2||first.bound||x.bound||first.type!=='cp'||x.type!=='cp'||first.score-x.score<=policy.candidateWindow);
  return [...new Set([r.bestMove,r.chosen,...near.map(x=>x.pv[0])])].slice(0,policy.candidateLimit);
}
const keyOf=(initial,moves,multipv)=>JSON.stringify([initial,moves,multipv]);
// Full history is part of identity: board-only transpositions can change
// repetition and perpetual-check rights. A stop never enters the cache.
export class SearchCoordinator {
  constructor(engine,policy=SEARCH_POLICY){this.engine=engine;this.policy=policy;this.cache=new Map();this.generation=0;this.hits=0;}
  peek(initial,moves,{time=3000,multipv=1}={}){const entry=this.cache.get(keyOf(initial,moves,multipv));return entry?.time>=time?structuredClone(entry.result):null;}
  async search(initial,moves,options={}){
    const {time=3000,multipv=1,fresh=false}=options,key=keyOf(initial,moves,multipv),old=this.cache.get(key),generation=this.generation;
    if(!fresh&&old&&old.time>=time){this.hits++;this.cache.delete(key);this.cache.set(key,old);return structuredClone(old.result);}
    const result=await this.engine.search(initial,moves,options);
    if(generation!==this.generation)throw new DOMException('解析を中止しました。','AbortError');
    const p=positionAt(initial,moves);
    if(result.infos.length&&result.infos.every(i=>i.pv.length&&checkedPV(p,i.pv).length===i.pv.length)){
      this.cache.delete(key);this.cache.set(key,{time,result:structuredClone(result),bytes:2*(key.length+JSON.stringify(result).length)});
      let bytes=[...this.cache.values()].reduce((sum,e)=>sum+e.bytes,0);
      while(this.cache.size>this.policy.cacheEntries||bytes>(this.policy.cacheBytes||524288)){const oldest=this.cache.keys().next().value;bytes-=this.cache.get(oldest).bytes;this.cache.delete(oldest);}
    }
    return result;
  }
  init(){return this.engine.init?.();}
  stop(){this.generation++;this.engine.stop();}
  terminate(){this.generation++;this.cache.clear();this.engine.terminate();}
}
