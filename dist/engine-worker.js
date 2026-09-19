/* The USI engine runs off the UI thread; its search uses one pthread. */
importScripts('./vendor/yaneuraou/yaneuraou.js');
let engine;
async function asset(name){
  const response=await fetch(new URL('./vendor/yaneuraou/'+name,self.location.href),{signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('エンジンを読み込めませんでした。接続を確認して再読み込みしてください。');
  return response.arrayBuffer();
}
self.onmessage=async({data})=>{try{if(data.type==='init'){
  if(engine)return;postMessage({type:'progress',text:'エンジンを読み込み中（約1.4MB）'});
  const [wasmBinary,evaluation]=await Promise.all([asset('yaneuraou.wasm'),asset('yaneuraou.data')]);
  engine=await YaneuraOu({wasmBinary,getPreloadedPackage:()=>evaluation,locateFile:file=>new URL('./vendor/yaneuraou/'+file,self.location.href).href,mainScriptUrlOrBlob:new URL('./vendor/yaneuraou/yaneuraou.js',self.location.href).href});
  engine.addMessageListener(line=>postMessage({type:'line',line}));postMessage({type:'loaded'});
}else if(data.type==='command'&&engine)engine.postMessage(data.command);}catch(e){postMessage({type:'error',message:e.message||String(e)});}};
