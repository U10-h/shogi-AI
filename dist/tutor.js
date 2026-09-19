import {moveTokens,normalizeNotation} from './coach-analysis.js';

export function validateTutorReply(raw,evidence){
  const data=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));
  if(typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>2200||!Array.isArray(data.evidence_ids)||!data.evidence_ids.length)throw Error('説明の根拠を確認できませんでした。');
  const ids=new Set(evidence.map(e=>e.id));if(data.evidence_ids.some(id=>!ids.has(id)))throw Error('説明が解析の根拠と一致しませんでした。');
  const source=evidence.map(e=>e.text).join('\n');const moves=new Set(moveTokens(source).map(normalizeNotation));
  if(moveTokens(data.answer).some(move=>!moves.has(normalizeNotation(move))))throw Error('解析していない指し手が説明に含まれたため、補足を表示しませんでした。');
  if(/絶対|必勝|必ず勝|確実に勝|詰み確定/.test(data.answer))throw Error('断定の根拠を確認できなかったため、補足を表示しませんでした。');
  const numbers=new Set(normalizeNotation(source).match(/-?\d+/g)||[]);
  if((normalizeNotation(data.answer).match(/-?\d+(?=点)/g)||[]).some(n=>!numbers.has(n)))throw Error('説明の評価値が解析結果と一致しませんでした。');
  return {answer:data.answer.trim(),evidence_ids:data.evidence_ids};
}

export class LocalTutor {
  constructor(onStatus=()=>{}){this.onStatus=onStatus;this.worker=null;this.ready=false;this.seq=0;this.generation=0;this.pending=new Map();}
  request(type,payload={},timeout=180000){const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.unload();reject(Error('対話モデルの処理が時間内に終わりませんでした。軽量モデルをお試しください。'));},timeout);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,type,...payload});});}
  async load(size='small'){
    if(this.ready)return;if(!globalThis.isSecureContext||!navigator.gpu)throw Error('このブラウザでは端末内の対話モデルを使えません。HTTPSのChromeで開くか、PCでお試しください。解析による解説はそのまま使えます。');
    const generation=++this.generation;const adapter=await navigator.gpu.requestAdapter();if(generation!==this.generation)throw Error('対話モデルの準備を中止しました。');if(!adapter)throw Error('対話モデル用のGPUを利用できません。解析による解説は使えます。');
    const precision=adapter.features.has('shader-f16')?'q4f16_1':'q4f32_1';
    const model='Qwen2.5-'+(size==='standard'?'1.5B':'0.5B')+'-Instruct-'+precision+'-MLC';
    this.worker=new Worker(new URL('./tutor-worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{if(data.type==='progress'){this.onStatus(data.text);return;}const item=this.pending.get(data.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(data.id);if(data.error)item.reject(Error(data.error));else item.resolve(data.result);};
    this.worker.onerror=()=>this.unload('対話モデルを読み込めませんでした。接続とブラウザの対応状況を確認してください。');
    try{await this.request('load',{model},600000);this.ready=true;this.onStatus('日本語対話を使用できます（端末内）');}catch(e){this.unload();throw e;}
  }
  async answer(question,evidence,history=[]){
    if(!this.ready)throw Error('対話モデルはまだ読み込まれていません。');
    const raw=await this.request('answer',{question:question.slice(0,500),evidence:evidence.map(e=>({...e,text:e.text.slice(0,260)})),history:history.slice(-2).map(x=>({role:x.role,text:x.text.slice(0,150)}))});
    return validateTutorReply(raw,evidence);
  }
  interrupt(){this.worker?.postMessage({type:'interrupt'});}
  unload(reason='対話モデルを停止しました。'){
    this.generation++;this.ready=false;this.worker?.terminate();this.worker=null;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error(reason));}this.pending.clear();
  }
}
