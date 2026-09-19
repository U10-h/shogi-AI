import {positionAt,moveLabel,scoreLabel,sideName} from './core.js';
import {positionKey,resolveMove,questionIntent,investigate,explainReport,reportEvidence} from './coach-analysis.js';
import {LocalTutor} from './tutor.js';

const $=id=>document.getElementById(id);
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}

export class Coach {
  constructor(bridge,engine){
    this.bridge=bridge;this.engine=engine;this.root=null;this.chosen=null;this.report=null;this.history=[];this.working=false;this.loading=false;this.allowed=true;this.job=0;this.gameId=null;
    this.tutor=new LocalTutor(text=>{$('tutor-status').textContent=text;});
    $('coach-ask').onsubmit=e=>{e.preventDefault();const text=$('coach-question').value.trim();if(text)this.ask(text);};
    $('coach-pick').onclick=()=>this.pick();
    $('coach-current').onclick=()=>this.adopt();
    $('coach-origin').onclick=()=>{if(this.root&&!this.working)this.bridge.showLine(this.root,[],0);};
    $('coach-cancel-pick').onclick=()=>{this.bridge.cancelPick();$('coach-picking').hidden=true;};
    $('coach-stop').onclick=()=>this.cancel();
    for(const button of document.querySelectorAll('[data-coach-question]'))button.onclick=()=>this.ask(button.dataset.coachQuestion);
    $('tutor-enable').onclick=()=>this.enableTutor();
    $('tutor-disable').onclick=()=>{this.tutor.unload();this.loading=false;$('tutor-status').textContent='日本語対話を停止しました。解析解説は使えます。';this.controls();};
    this.message('assistant','盤面で候補を選ぶか、「7六歩はどう？」のように入力してください。最善候補との比較、相手の反論、その先の読みを一緒に確認できます。');
    this.controls();
  }
  sync(state){
    this.allowed=state.allowed;
    if(this.gameId!==null&&this.gameId!==state.gameId){this.cancel();this.root=null;this.chosen=null;this.report=null;this.history=[];$('coach-selection').textContent='候補手：未選択';$('coach-question').value='';$('coach-chat').replaceChildren();$('coach-report').replaceChildren();this.message('assistant','新しい対局です。相談したい局面で候補を選んでください。');}
    this.gameId=state.gameId;
    const different=this.root&&positionKey(this.root)!==positionKey(state.root);
    $('coach-context').textContent=!this.allowed?'実戦モードでは終局後に相談できます。':!this.root?'表示中の局面から相談します。':'相談の基準：'+this.root.moves.length+'手目・'+sideName(positionAt(this.root.initial,this.root.moves).color)+(different?'（盤面は別の局面を表示中）':'');
    $('coach-origin').hidden=!different;
    $('coach-body').hidden=!this.allowed;
    this.controls();
  }
  controls(){
    const locked=this.working||!this.allowed;
    for(const id of ['coach-send','coach-pick','coach-current','coach-question'])$(id).disabled=locked;
    $('coach-origin').disabled=locked;
    for(const b of document.querySelectorAll('[data-coach-question]'))b.disabled=locked;
    $('coach-stop').hidden=!this.working;
    $('tutor-enable').disabled=this.loading||this.working||this.tutor.ready;
    $('tutor-model').disabled=this.loading||this.tutor.ready;
    $('tutor-disable').hidden=!this.loading&&!this.tutor.ready;
    for(const button of $('coach-report').querySelectorAll('button'))button.disabled=locked;
    for(const button of $('coach-chat').querySelectorAll('button'))button.disabled=locked;
  }
  message(role,text,choices=null){
    const row=el('div',undefined,'coach-message '+role);row.append(el('span',role==='user'?'あなた':'検討コーチ','coach-speaker'),el('p',text));
    if(choices){const actions=el('div',undefined,'move-chips');for(const choice of choices){const b=el('button',choice.label);b.type='button';b.onclick=choice.action;actions.append(b);}row.append(actions);}
    $('coach-chat').append(row);while($('coach-chat').children.length>16)$('coach-chat').firstChild.remove();
    this.history.push({role,text});this.history=this.history.slice(-12);$('coach-chat').scrollTop=$('coach-chat').scrollHeight;
    return row;
  }
  async adopt(){
    if(!this.allowed||this.working)return;await this.bridge.prepare();const next=structuredClone(this.bridge.current());
    if(!this.root||positionKey(next)!==positionKey(this.root)){
      this.root=next;this.chosen=null;this.report=null;this.history=[];$('coach-chat').replaceChildren();$('coach-report').replaceChildren();
      this.message('assistant',next.moves.length+'手目を相談の基準にしました。盤面を進めても、相談の基準はこの局面に保ちます。「表示局面で相談」を押すと切り替わります。');
    }
    $('coach-selection').textContent=this.chosen?moveLabel(positionAt(this.root.initial,this.root.moves),this.chosen):'候補手：未選択';
    this.bridge.refresh();
  }
  async pick(){if(this.working||!this.allowed)return;await this.adopt();this.bridge.pick(this.root);$('coach-picking').hidden=false;}
  choose(usi){
    if(!this.root)return;this.chosen=usi;this.report=null;$('coach-report').replaceChildren();$('coach-picking').hidden=true;
    const label=moveLabel(positionAt(this.root.initial,this.root.moves),usi);$('coach-selection').textContent='あなたの候補：'+label;
    $('coach-question').value=label+'はどう？';$('coach-question').focus();
    this.message('assistant',label+'を候補にしました。狙いも書き添えて「質問する」を押してください。本対局にはまだ指していません。');
  }
  cancel(){this.job++;this.engine.stop();this.tutor.interrupt();this.bridge.cancelPick();$('coach-picking').hidden=true;}
  async enableTutor(){
    this.loading=true;this.controls();$('tutor-status').textContent='対応状況を確認しています…';
    try{await this.tutor.load($('tutor-model').value);}catch(e){$('tutor-status').textContent=e.message;}finally{this.loading=false;this.controls();}
  }
  async ask(question){if(this.submitting)return;this.submitting=true;try{return await this.askQuestion(question);}finally{this.submitting=false;this.controls();}}
  async askQuestion(question){
    if(this.working||!this.allowed)return;if(question.length>800){this.message('assistant','質問は800文字以内でお願いします。');return;}
    if(!this.root)await this.adopt();await this.bridge.prepare();this.bridge.cancelPick();$('coach-picking').hidden=true;
    const intent=questionIntent(question),p=positionAt(this.root.initial,this.root.moves);
    const intendedReply=intent==='reply';const lookup=intendedReply&&this.chosen?positionAt(this.root.initial,[...this.root.moves,this.chosen]):p;
    const parsed=resolveMove(lookup,question);
    this.message('user',question);$('coach-question').value='';
    if(intendedReply&&!this.chosen){this.message('assistant','まず自分の候補手を選んで評価してください。その後で相手の応手を指定できます。');return;}
    if(parsed.kind==='illegal'){this.message('assistant',parsed.token+'は'+(intendedReply?'その候補を指した後の相手の手':'相談の基準局面の手')+'として指せません。手番、移動元、成り・不成を確認してください。');return;}
    if(parsed.kind==='ambiguous'){this.message('assistant','同じ表記で複数の手が指せます。移動元を指定してください。',parsed.choices.map(c=>({...c,action:()=>this.ask((intendedReply?'相手が':'')+c.usi+(intendedReply?'なら？':'はどう？'))})));return;}
    if(parsed.kind==='none'&&!this.chosen&&intent==='explain'&&/[歩香桂銀金角飛玉]/.test(question)){
      this.message('assistant','どの手を考えているか、盤面で選択するか「7六歩」「7g7f」のように指定してください。駒が複数ある場合は盤面での選択が確実です。');return;
    }
    let reply=null;if(parsed.kind==='move'){if(intendedReply)reply=parsed.usi;else {this.chosen=parsed.usi;if(this.report?.chosen!==this.chosen)this.report=null;}}
    if(intendedReply&&!reply){this.message('assistant','相手の応手を「相手が3四歩なら？」のように升目と駒で指定してください。');return;}
    const previous=this.report,time=intent==='deeper'?Math.min(30000,Math.max(5000,Math.max(previous?.time||0,this.bridge.time())*2)):Math.max(previous?.time||0,this.bridge.time());
    const id=++this.job,sessionGameId=this.gameId;this.working=true;this.controls();$('coach-progress').textContent='解析を始めます…';
    const check=()=>{if(id!==this.job)throw new DOMException('相談の解析を中止しました。','AbortError');};
    try{
      if(!this.report||intent==='deeper'||reply||time>this.report.time){
        const report=await this.bridge.run(async hostCheck=>investigate(this.engine,this.root,this.chosen,{time,reply,onProgress:text=>{$('coach-progress').textContent=text+'（各探索 '+time/1000+'秒）';},check:()=>{hostCheck();check();}}));check();this.report=report;
        this.chosen=this.report.chosen;
      }
      this.drawReport();
      let explanation=explainReport(this.report,intent);
      if(intent==='deeper'&&previous){explanation='各探索を'+time/1000+'秒にして再検討しました。'+(previous.bestMove===this.report.bestMove?'最善候補は変わりませんでした。':'最善候補が変わりました。以前の結論は更新します。')+'\n\n'+explanation;}
      this.message('assistant',explanation);
      if(this.tutor.ready){
        $('coach-progress').textContent='質問に合わせて日本語で説明しています…';
        try{const evidence=reportEvidence(this.report);const answer=await this.tutor.answer(question,evidence,this.history.slice(0,-2));check();this.message('assistant','日本語対話の補足：\n'+answer.answer+'\n\n参照：'+answer.evidence_ids.join('、')+'。補足文には誤りがあり得るため、上の解析手順も確認してください。');}
        catch(e){check();this.message('assistant',e.message+' 将棋エンジンの解析結果は上に残しています。');}
      }else if(intent==='explain'&&!moveTokensPresent(question))this.message('assistant','この回答は解析結果から組み立てた解説です。質問の細かな意図に合わせた自由な対話は、下の「日本語対話を有効にする」で追加できます。');
      $('coach-progress').textContent='解析済み · '+new Date(this.report.createdAt).toLocaleTimeString('ja-JP')+' · 各探索 '+this.report.time/1000+'秒';
    }catch(e){$('coach-progress').textContent='';if(sessionGameId===this.gameId)this.message('assistant',e.name==='AbortError'?'解析を中止しました。':e.message);}
    finally{this.working=false;this.controls();this.bridge.refresh();}
  }
  drawReport(){
    const r=this.report,p=positionAt(r.root.initial,r.root.moves);$('coach-selection').textContent='あなたの候補：'+moveLabel(p,r.chosen);
    const box=$('coach-report');box.replaceChildren();
    const comparison=el('div',undefined,'coach-comparison');comparison.append(el('p','今回の最善候補 '+moveLabel(p,r.bestMove)+'　'+scoreLabel(r.best.score)),el('p','あなたの候補 '+moveLabel(p,r.chosen)+'　'+scoreLabel(r.defense.score)),el('small',sideName(r.side)+'視点。探索時間ごとの暫定評価です。'));
    box.append(comparison);
    for(const branch of [r.best,r.defense,r.opportunity,r.assumption].filter(Boolean)){
      if(branch.id==='best'&&r.chosen===r.bestMove)continue;
      const section=el('details',undefined,'coach-line');section.open=branch.id==='defense'||branch.id==='assumption';section.append(el('summary',branch.title+'　'+scoreLabel(branch.score)));
      const chips=el('div',undefined,'move-chips');
      const start=el('button','開始局面');start.type='button';start.onclick=()=>this.bridge.showLine(r.root,branch.pv,0);chips.append(start);
      branch.evidence.moves.forEach((move,i)=>{const b=el('button',(i+1)+'. '+move.label);b.type='button';b.onclick=()=>this.bridge.showLine(r.root,branch.pv,i+1);chips.append(b);});
      section.append(chips,el('p',branch.evidence.summary,'micro'));box.append(section);
    }
    box.append(el('p','手順を開いて別の手を試したら、「表示局面で相談」でその先を掘り下げられます。','micro'));
  }
}
function moveTokensPresent(s){return /[1-9１-９][一二三四五六七八九1-9１-９]|[1-9][a-i]/.test(s);}
