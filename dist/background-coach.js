import {positionAt,checkedPV} from './core.js';
import {positionKey} from './coach-analysis.js';
import {teachingEnabled,reviewPlayedMove,moveGrade} from './teacher-analysis.js';

const abort=()=>new DOMException('見守りを中止しました。','AbortError');
export function belongsToGame(root,played,game){
  const prefix=[...root.moves,...(played?[played]:[])];
  return root.initial===game.initial&&prefix.length<=game.moves.length&&prefix.every((m,i)=>m===game.moves[i]);
}

// One independent, single-threaded engine handles background work. The game
// engine never waits for this queue. Completed exact-history roots are reused.
export class BackgroundCoach {
  constructor(engine,{onReport=()=>{},onStatus=()=>{}}={}){
    this.engine=engine;this.onReport=onReport;this.onStatus=onStatus;this.game=null;this.enabled=false;this.generation=0;this.queue=[];this.warm=null;this.active=null;this.pending=Promise.resolve();this.cache=new Map();this.warmed='';this.failed=false;
  }
  status(text){this.onStatus(text);}
  update(game,{running,mode,occupied=false}){
    const changed=this.game&&(this.game.id!==game.id||!belongsToGame(this.game,null,game));
    if(changed){this.pause();this.cache.clear();this.warmed='';this.failed=false;}
    this.game=structuredClone(game);
    const enabled=running&&mode==='play'&&!occupied&&!game.result&&teachingEnabled(game)&&game.backgroundCoaching!==false;
    if(!enabled){if(this.enabled)this.pause();return;}
    this.enabled=true;
    if(this.failed)return;
    const root={initial:game.initial,moves:[...game.moves]},key=positionKey(root);
    if(positionAt(root.initial,root.moves).color===game.human&&this.warmed!==key){
      this.warmed=key;this.warm={kind:'warm',gameId:game.id,root,time:this.budget()};
    }
    this.pump();
  }
  budget(){return Math.min(1500,this.game?.thinkTime||1000);}
  played(root,played){
    if(!this.enabled||this.failed)return;
    this.warm=null;
    this.queue.push({kind:'review',gameId:this.game.id,root:structuredClone(root),played,time:this.budget()});
    this.queue=this.queue.slice(-2);this.pump();
  }
  valid(task){
    if(!this.game||task.gameId!==this.game.id)return false;
    if(task.kind==='warm')return belongsToGame(task.root,null,this.game);
    return belongsToGame(task.root,task.played,this.game)&&this.game.moves.length-(task.root.moves.length+1)<=4;
  }
  async search(initial,moves,options,check){
    check();const key=positionKey({initial,moves})+'|'+options.multipv,old=this.cache.get(key);
    if(old&&old.time>=options.time)return structuredClone(old.result);
    const result=await this.engine.search(initial,moves,options);check();
    const p=positionAt(initial,moves);
    if(result.infos?.length&&result.infos.every(i=>i.pv.length&&checkedPV(p,i.pv).length===i.pv.length)){
      this.cache.delete(key);this.cache.set(key,{time:options.time,result:structuredClone(result)});
      while(this.cache.size>16)this.cache.delete(this.cache.keys().next().value);
    }
    return result;
  }
  pump(){
    if(this.active||!this.enabled||this.failed)return;
    const task=this.queue.shift()||this.warm;if(!task){this.status('対局を見守っています');return;}
    if(task===this.warm)this.warm=null;
    if(!this.valid(task)){this.pump();return;}
    this.active=task;const generation=this.generation;
    const check=()=>{if(generation!==this.generation||!this.enabled||!this.valid(task))throw abort();};
    this.status('続きを確かめながら見守っています');
    this.pending=(async()=>{
      const adapter={search:(initial,moves,options)=>this.search(initial,moves,options,check)};
      try{
        if(task.kind==='warm')await adapter.search(task.root.initial,task.root.moves,{time:task.time,multipv:3});
        else{
          const report=await reviewPlayedMove(adapter,task.root,task.played,{time:task.time,check});check();
          const concern=moveGrade(report)==='concern'&&report.checkedAgain&&!report.reconsidered;
          this.onReport(report,{gameId:task.gameId,concern});
        }
      }catch(e){if(generation===this.generation&&e.name!=='AbortError'){this.failed=true;this.queue=[];this.warm=null;this.status('見守り解析を休止しています。対局は続けられます。');}}
      finally{this.active=null;if(this.enabled&&!this.failed)this.pump();}
    })();
  }
  pause(){
    this.enabled=false;this.generation++;this.queue=[];this.warm=null;this.warmed='';if(this.active)this.engine.stop();
    return this.pending.catch(()=>{});
  }
  retry(){this.failed=false;this.warmed='';}
}
