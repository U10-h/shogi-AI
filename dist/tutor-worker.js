import {tutorMessages,TUTOR_TUNING} from './tutor-prompt.js';
/* Optional, downloaded only after the user chooses to enable local conversation. */
let engine;
self.onmessage=async({data})=>{
  if(data.type==='interrupt'){engine?.interruptGenerate();return;}
  try{
    if(data.type==='load'){
      const {CreateMLCEngine}=await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm');
      engine=await CreateMLCEngine(data.model,{initProgressCallback:p=>postMessage({type:'progress',text:'日本語対話を準備中 '+Math.round(p.progress*100)+'% — '+p.text})},{context_window_size:4096,temperature:0.25});
      postMessage({id:data.id,result:true});return;
    }
    if(data.type==='answer'){
      if(!engine)throw Error('対話モデルを先に読み込んでください。');
      const messages=tutorMessages(data);
      const result=await engine.chat.completions.create({messages,temperature:TUTOR_TUNING.temperature,max_tokens:TUTOR_TUNING.maxTokens,response_format:{type:'json_object'},stream:false});
      if(result.choices[0]?.finish_reason==='length')throw Error('説明が長くなったため中断しました。質問を短くするか、軽量な解析解説をご利用ください。');
      postMessage({id:data.id,result:result.choices[0]?.message?.content||''});
    }
  }catch(e){postMessage({id:data.id,error:e.message||String(e)});}
};
