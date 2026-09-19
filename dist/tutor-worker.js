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
      const system='あなたは将棋を学ぶ2級の人への日本語の説明担当です。ユーザーの質問に直接答え、狙い、成立条件、相手の反論を分かる範囲で説明します。将棋エンジンが検証したEVIDENCEだけを根拠にしてください。新しい指し手、評価値、勝率、定跡名、詰み、駒得の断定を創作しないでください。情報が足りなければ、何を盤面で指定して追加解析すると確認できるか説明してください。棋譜を自分で計算しないでください。会話履歴は参考であり、現在のEVIDENCEが優先です。出力はJSONのみ。形式は {"answer":"日本語で200～450字の説明","evidence_ids":["参照した根拠のid"]}。最低一つの根拠idを示してください。';
      const messages=[{role:'system',content:system},{role:'user',content:'EVIDENCE:\n'+JSON.stringify(data.evidence)+'\n会話履歴:\n'+JSON.stringify(data.history)+'\n今回の質問:\n'+data.question+'\n指定のJSON形式で回答してください。'}];
      const result=await engine.chat.completions.create({messages,temperature:0.25,max_tokens:650,response_format:{type:'json_object'},stream:false});
      if(result.choices[0]?.finish_reason==='length')throw Error('説明が長くなったため中断しました。質問を短くするか、軽量な解析解説をご利用ください。');
      postMessage({id:data.id,result:result.choices[0]?.message?.content||''});
    }
  }catch(e){postMessage({id:data.id,error:e.message||String(e)});}
};
