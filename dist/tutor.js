import {questionIntent} from './coach-analysis.js';
import {validateTutorReply} from './tutor-grounding.js';
export {validateTutorReply} from './tutor-grounding.js';

// Leave room for the question, learner forecast and answer in the 4096-token
// model. Put the current position and the requested branch ahead of other lines.
export function selectTutorEvidence(evidence,question,options={}){
  const intent=questionIntent(question),branch=intent==='reply'?'assumption':intent==='opportunity'?'opportunity':intent==='best'?'best':'defense';
  const concepts=evidence.filter(e=>e.kind==='concept').map(e=>e.id);
  // Keep both sides of a comparison ahead of commentary. A single well-packed
  // branch cannot answer why it differs from another candidate.
  const branches=[...new Set([branch,...(['compare','verify','plan','best'].includes(intent)?['defense','best']:[])])];
  const priority=options.style==='teacher'?['position',...branches,'teaching_focus',...concepts,'evaluation','teacher',branch+'_outlook']:intent==='verify'?['position',...branches,'verification','working']:intent==='plan'?['position',...branches,'defense_outlook','best_outlook','opportunity_outlook']:['position',...branches,...concepts,branch+'_outlook','comparison','working'];
  const unique=[...new Map(evidence.map(e=>[e.id,e])).values()];
  const ordered=[...priority.map(id=>unique.find(e=>e.id===id)).filter(Boolean),...unique.filter(e=>!priority.includes(e.id))];
  let budget=1100;const packed=[];
  for(const item of ordered){if(budget<80)break;
    // Keep a complete seven-ply line together; do not truncate a move or its
    // score into a different claim. Structured fields are authored evidence.
    const moves=item.kind==='line'?item.moves.slice(0,7):null;
    const prefix=moves?item.title+'：'+moves.join(' → ')+'。':'';
    const compact=moves?prefix+item.resultText:item.text;
    const limit=Math.min(item.kind==='line'?300:190,budget);
    let text=compact;
    if(prefix.length>limit)continue;
    if(text.length>limit){const cut=text.slice(0,limit),end=cut.lastIndexOf('。');text=end>=30?cut.slice(0,end+1):cut.slice(0,-1)+'…';}
    packed.push({id:item.id,text,...(moves?{kind:'line',moves}:item.kind==='concept'?{kind:item.kind,terms:item.terms}:{} )});budget-=text.length;
  }
  return packed;
}

export class LocalTutor {
  constructor(onStatus=()=>{}){this.onStatus=onStatus;this.worker=null;this.ready=false;this.seq=0;this.generation=0;this.pending=new Map();this.loadPromise=null;}
  request(type,payload={},timeout=180000){
    if(!this.worker)return Promise.reject(Error('対話モデルは停止しています。'));
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.unload('対話モデルの処理が時間内に終わりませんでした。軽量モデルをお試しください。'),timeout);
      this.pending.set(id,{type,resolve,reject,timer});
      try{this.worker.postMessage({id,type,...payload});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  load(size='small'){
    if(this.ready)return Promise.resolve();if(this.loadPromise)return this.loadPromise;
    const generation=++this.generation;
    this.loadPromise=this.initialize(size,generation).catch(e=>{if(generation===this.generation)this.unload(e.message);throw e;}).finally(()=>{if(generation===this.generation)this.loadPromise=null;});
    return this.loadPromise;
  }
  async initialize(size,generation){
    if(!globalThis.isSecureContext||!navigator.gpu)throw Error('このブラウザでは端末内の対話モデルを使えません。HTTPSのChromeで開くか、PCでお試しください。解析による解説はそのまま使えます。');
    const adapter=await navigator.gpu.requestAdapter();if(generation!==this.generation)throw new DOMException('対話モデルの準備を中止しました。','AbortError');if(!adapter)throw Error('対話モデル用のGPUを利用できません。解析による解説は使えます。');
    const precision=adapter.features.has('shader-f16')?'q4f16_1':'q4f32_1';
    const model='Qwen2.5-'+(size==='standard'?'1.5B':'0.5B')+'-Instruct-'+precision+'-MLC';
    const worker=this.worker=new Worker(new URL('./tutor-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{if(worker!==this.worker||generation!==this.generation)return;if(data.type==='progress'){this.onStatus(data.text);return;}const item=this.pending.get(data.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(data.id);if(data.error)item.reject(Error(data.error));else item.resolve(data.result);};
    worker.onerror=()=>{if(worker===this.worker)this.unload('対話モデルを読み込めませんでした。接続とブラウザの対応状況を確認してください。');};
    await this.request('load',{model},600000);
    if(generation!==this.generation)throw new DOMException('対話モデルの準備を中止しました。','AbortError');
    this.ready=true;this.onStatus('日本語対話を使用できます（端末内）');
  }
  async answer(question,evidence,history=[],forecast={},options={}){
    if(!this.ready)throw Error('対話モデルはまだ読み込まれていません。');
    const packed=selectTutorEvidence(evidence,question,options);
    const raw=await this.request('answer',{style:options.style==='teacher'?'teacher':'analysis',question:question.slice(0,300),evidence:packed,history:history.slice(-2).map(x=>({role:x.role,text:x.text.slice(0,100)})),forecast:{hope:(forecast.hope||'').slice(0,120),worry:(forecast.worry||'').slice(0,120)}});
    return validateTutorReply(raw,packed);
  }
  interrupt(){
    this.worker?.postMessage({type:'interrupt'});
    for(const [id,item]of this.pending)if(item.type==='answer'){clearTimeout(item.timer);this.pending.delete(id);item.reject(new DOMException('対話を中止しました。','AbortError'));}
  }
  unload(reason='対話モデルを停止しました。'){
    this.generation++;this.ready=false;this.loadPromise=null;this.worker?.terminate();this.worker=null;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error(reason));}this.pending.clear();
  }
}
