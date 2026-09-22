// USI can end partway through a MultiPV iteration. Do not rank a new depth's
// first move against the previous depth's other moves (or duplicate a move).
export class SearchResults {
  constructor(width){this.width=width;this.depths=new Map();this.latest=new Map();}
  add(info){this.latest.set(info.rank,info);let row=this.depths.get(info.depth);if(!row)this.depths.set(info.depth,row=new Map());row.set(info.rank,info);while(this.depths.size>4)this.depths.delete(this.depths.keys().next().value);}
  finish(bestmove){
    for(const [,row]of [...this.depths].sort((a,b)=>b[0]-a[0])){
      const items=[...row.values()].sort((a,b)=>a.rank-b.rank);
      if(items.length===this.width&&items.every((i,n)=>i.rank===n+1)&&new Set(items.map(i=>i.pv[0])).size===items.length&&items[0].pv[0]===bestmove)return items;
    }
    // Fewer legal moves, mate, or a stopped partial iteration. Keep the actual
    // bestmove first; mark incomparable alternatives so no cp gap is asserted.
    const items=[...this.latest.values()].sort((a,b)=>(b.pv[0]===bestmove)-(a.pv[0]===bestmove)||a.rank-b.rank),seen=new Set();
    return items.filter(i=>!seen.has(i.pv[0])&&seen.add(i.pv[0])).map((i,n)=>({...i,rank:n+1,bound:this.width>1||i.bound,partial:true}));
  }
}
