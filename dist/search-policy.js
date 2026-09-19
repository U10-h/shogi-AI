import {positionAt,checkedPV} from './core.js';

export const SEARCH_POLICY=Object.freeze({revision:12,cacheEntries:48,pvInterval:200,consideration:true,efficientDeep:true,probeRatio:0.8,candidateLimit:4,candidateWindow:180,focusPool:6,replyRatio:1,recheckContradiction:true,reuseWarm:true,widenGap:100});
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
    if(!fresh&&old&&old.time>=time){this.hits++;return structuredClone(old.result);}
    const result=await this.engine.search(initial,moves,options);
    if(generation!==this.generation)throw new DOMException('解析を中止しました。','AbortError');
    const p=positionAt(initial,moves);
    if(result.infos.length&&result.infos.every(i=>i.pv.length&&checkedPV(p,i.pv).length===i.pv.length)){
      this.cache.delete(key);this.cache.set(key,{time,result:structuredClone(result)});
      while(this.cache.size>this.policy.cacheEntries)this.cache.delete(this.cache.keys().next().value);
    }
    return result;
  }
  init(){return this.engine.init?.();}
  stop(){this.generation++;this.engine.stop();}
  terminate(){this.generation++;this.cache.clear();this.engine.terminate();}
}
