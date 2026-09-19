import {positionAt,moveLabel,scoreLabel,sideName} from './core.js';
import {positionKey,resolveMove,questionIntent,investigate,explainReport,reportEvidence,branchRoot,reportBranches,lineOutlook,explainPlan} from './coach-analysis.js';
import {LocalTutor} from './tutor.js';

const $=id=>document.getElementById(id);
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}

export class Coach {
  constructor(bridge,engine){
    this.bridge=bridge;this.engine=engine;this.root=null;this.chosen=null;this.report=null;this.history=[];this.trail=[];this.transition='';this.learnerSide=null;this.working=false;this.loading=false;this.allowed=true;this.job=0;this.gameId=null;
    this.tutor=new LocalTutor(text=>{$('tutor-status').textContent=text;});
    $('coach-ask').onsubmit=e=>{e.preventDefault();const text=$('coach-question').value.trim();if(text)this.ask(text);};
    $('coach-pick').onclick=()=>this.pick();
    $('coach-current').onclick=()=>this.adopt();
    $('coach-back').onclick=()=>this.back();
    $('coach-compare-plan').onclick=()=>this.ask('この局面で嬉しい展開と困る展開を、私の予想と照らし合わせて考えたい');
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
    if(this.gameId!==null&&this.gameId!==state.gameId){this.cancel();this.root=null;this.chosen=null;this.report=null;this.history=[];this.trail=[];this.transition='';this.learnerSide=null;this.setNotes({});$('coach-selection').textContent='候補手：未選択';$('coach-question').value='';$('coach-chat').replaceChildren();$('coach-report').replaceChildren();this.message('assistant','新しい対局です。相談したい局面で候補を選んでください。');}
    this.gameId=state.gameId;
    const different=this.root&&positionKey(this.root)!==positionKey(state.root);
    $('coach-context').textContent=!this.allowed?'実戦モードでは終局後に相談できます。':!this.root?'表示中の局面から相談します。':'相談の基準：'+this.root.moves.length+'手目・'+sideName(positionAt(this.root.initial,this.root.moves).color)+(different?'（盤面は別の局面を表示中）':'');
    $('coach-origin').hidden=!different;
    $('coach-back').hidden=!this.trail.length;
    $('coach-trail').textContent=this.root?this.transition||'ここから読みを始めます。':'';
    $('coach-perspective').textContent=this.learnerSide?sideName(this.learnerSide)+'の立場で考えます。':'対局設定のあなたの側から、嬉しい・困るを考えます。';
    $('coach-body').hidden=!this.allowed;
    this.controls();
  }
  controls(){
    const locked=this.working||this.navigating||!this.allowed;
    for(const id of ['coach-send','coach-pick','coach-current','coach-question','coach-back','coach-hope','coach-worry','coach-compare-plan'])$(id).disabled=locked||!!this.navigating;
    $('coach-origin').disabled=locked;
    for(const b of document.querySelectorAll('[data-coach-question]'))b.disabled=locked;
    $('coach-stop').hidden=!this.working;
    $('tutor-enable').disabled=this.loading||this.working||this.tutor.ready;
    $('tutor-model').disabled=this.loading||this.tutor.ready;
    $('tutor-disable').hidden=!this.loading&&!this.tutor.ready;
    for(const button of $('coach-report').querySelectorAll('button'))button.disabled=locked||button.dataset.tooShort==='true';
    for(const button of $('coach-chat').querySelectorAll('button'))button.disabled=locked;
  }
  message(role,text,choices=null){
    const row=el('div',undefined,'coach-message '+role);row.append(el('span',role==='user'?'あなた':'検討コーチ','coach-speaker'),el('p',text));
    if(choices){const actions=el('div',undefined,'move-chips');for(const choice of choices){const b=el('button',choice.label);b.type='button';b.onclick=choice.action;actions.append(b);}row.append(actions);}
    $('coach-chat').append(row);while($('coach-chat').children.length>16)$('coach-chat').firstChild.remove();
    this.history.push({role,text});this.history=this.history.slice(-12);$('coach-chat').scrollTop=$('coach-chat').scrollHeight;
    return row;
  }
  notes(){return {hope:$('coach-hope').value.trim(),worry:$('coach-worry').value.trim()};}
  setNotes(notes){$('coach-hope').value=notes.hope||'';$('coach-worry').value=notes.worry||'';}
  snapshot(){return structuredClone({root:this.root,chosen:this.chosen,report:this.report,history:this.history,transition:this.transition,learnerSide:this.learnerSide,notes:this.notes(),question:$('coach-question').value});}
  enter(next,transition){
    if(this.root){
      const prior=this.snapshot();this.trail.push(prior);this.trail=this.trail.slice(-24);
      if(prior.notes.hope||prior.notes.worry)this.message('user','前の'+prior.root.moves.length+'手目での予想（未検証）\n嬉しい展開：'+(prior.notes.hope||'考え中')+'\n困る展開：'+(prior.notes.worry||'考え中'));
    }
    else this.learnerSide=this.bridge.learnerSide?.()||positionAt(next.initial,next.moves).color;
    this.root=structuredClone(next);this.chosen=null;this.report=null;this.transition=transition;
    this.setNotes({});$('coach-question').value='';$('coach-report').replaceChildren();$('coach-progress').textContent='';$('coach-selection').textContent='候補手：未選択';
    this.message('assistant',transition+'\n'+sideName(this.learnerSide)+'の立場で、嬉しい展開と困る展開を予想してみましょう。次の候補を盤面で選ぶか、「ここから何を目指す？」と質問できます。');
    this.bridge.refresh();
  }
  async follow(branch,plies=2){
    if(this.working||this.navigating||!this.allowed)return;
    this.navigating=true;this.controls();
    try{
      const gameId=this.gameId;await this.bridge.prepare();if(gameId!==this.gameId)return;
      const root=this.root,next=branchRoot(root,branch,plies),labels=branch.evidence.moves.slice(0,plies).map(m=>m.label).join(' → ');
      await this.bridge.showLine(root,branch.pv,plies);
      this.enter(next,root.moves.length+'手目の「'+branch.title+'」から '+labels+'。'+plies+'手進めた'+next.moves.length+'手目の相談です。');
      $('coach-plan').open=true;
    }catch(e){this.message('assistant',e.message);}
    finally{this.navigating=false;this.controls();}
  }
  async back(){
    if(this.working||this.navigating||!this.allowed||!this.trail.length)return;
    this.navigating=true;this.controls();
    try{
      const gameId=this.gameId;await this.bridge.prepare();if(gameId!==this.gameId)return;const prior=this.trail.pop();
      for(const key of ['root','chosen','report','transition','learnerSide'])this[key]=prior[key];
      this.history=[];$('coach-chat').replaceChildren();for(const item of prior.history)this.message(item.role,item.text);
      this.setNotes(prior.notes);$('coach-question').value=prior.question;
      $('coach-report').replaceChildren();if(this.report)this.drawReport();else $('coach-selection').textContent=this.chosen?'あなたの候補：'+moveLabel(positionAt(this.root.initial,this.root.moves),this.chosen):'候補手：未選択';
      await this.bridge.showLine(this.root,[],0);this.bridge.refresh();
    }finally{this.navigating=false;this.controls();}
  }
  async adopt(){
    if(!this.allowed||this.working||this.navigating)return;await this.bridge.prepare();const next=structuredClone(this.bridge.current());
    if(!this.root||positionKey(next)!==positionKey(this.root)){
      const draft=!this.root?this.notes():null;
      this.enter(next,(this.root?this.root.moves.length+'手目の相談から切り替え、':'')+next.moves.length+'手目を相談の基準にしました。');
      if(draft)this.setNotes(draft);
    }
    $('coach-selection').textContent=this.chosen?moveLabel(positionAt(this.root.initial,this.root.moves),this.chosen):'候補手：未選択';
    this.bridge.refresh();
  }
  async pick(){if(this.working||this.navigating||!this.allowed)return;await this.adopt();this.bridge.pick(this.root);$('coach-picking').hidden=false;}
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
    if(this.working||this.navigating||!this.allowed)return;if(question.length>800){this.message('assistant','質問は800文字以内でお願いします。');return;}
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
    const notes=this.notes();
    if(intent==='plan'&&(notes.hope||notes.worry))this.message('user','私の予想（未検証）\n嬉しい展開：'+(notes.hope||'まだ考え中')+'\n困る展開：'+(notes.worry||'まだ考え中'));
    const id=++this.job,sessionGameId=this.gameId;this.working=true;this.controls();$('coach-progress').textContent='解析を始めます…';
    const check=()=>{if(id!==this.job)throw new DOMException('相談の解析を中止しました。','AbortError');};
    try{
      if(!this.report||intent==='deeper'||reply||time>this.report.time){
        const report=await this.bridge.run(async hostCheck=>investigate(this.engine,this.root,this.chosen,{time,reply,onProgress:text=>{$('coach-progress').textContent=text+'（各探索 '+time/1000+'秒）';},check:()=>{hostCheck();check();}}));check();this.report=report;
        this.chosen=this.report.chosen;
      }
      this.drawReport();
      if(intent==='future'){
        const branches=reportBranches(this.report).filter(b=>b.pv.length>=2);
        this.message('assistant',branches.length?'どの読み筋の2手先へ進みますか？ ここでの2手は、手番側の一手と相手の応手です。進んだ局面を基準に、次の候補を相談できます。':'この読み筋には2手分の続きがありません。一手ずつ進めて終局状態を確認してください。',branches.map(b=>({label:b.title+'：'+b.evidence.moves.slice(0,2).map(m=>m.label).join(' → '),action:()=>this.follow(b)})));
        $('coach-progress').textContent='相談する読み筋を選んでください。';
        return;
      }
      let explanation=intent==='plan'?explainPlan(this.report,this.learnerSide):explainReport(this.report,intent);
      if(intent==='deeper'&&previous){explanation='各探索を'+time/1000+'秒にして再検討しました。'+(previous.bestMove===this.report.bestMove?'最善候補は変わりませんでした。':'最善候補が変わりました。以前の結論は更新します。')+'\n\n'+explanation;}
      this.message('assistant',explanation);
      if(this.tutor.ready){
        $('coach-progress').textContent='質問に合わせて日本語で説明しています…';
        try{const evidence=reportEvidence(this.report,this.learnerSide);const answer=await this.tutor.answer(question,evidence,this.history.slice(0,-2),notes);check();this.message('assistant','日本語対話の補足：\n'+answer.answer+'\n\n参照：'+answer.evidence_ids.join('、')+'。補足文には誤りがあり得るため、上の解析手順も確認してください。');}
        catch(e){check();this.message('assistant',e.message+' 将棋エンジンの解析結果は上に残しています。');}
      }else if(intent==='plan'&&(notes.hope||notes.worry))this.message('assistant','予想はこの相談に残しました。まず、読み筋のどの盤面で予想が実現するか、または崩れるかを比べてください。文章の意味に合わせた補足は「日本語対話を有効にする」で追加できます。予想の正誤を自動で断定するものではありません。');
      else if(intent==='explain'&&!moveTokensPresent(question))this.message('assistant','この回答は解析結果から組み立てた解説です。質問の細かな意図に合わせた自由な対話は、下の「日本語対話を有効にする」で追加できます。');
      $('coach-progress').textContent='解析済み · '+new Date(this.report.createdAt).toLocaleTimeString('ja-JP')+' · 各探索 '+this.report.time/1000+'秒';
    }catch(e){$('coach-progress').textContent='';if(sessionGameId===this.gameId)this.message('assistant',e.name==='AbortError'?'解析を中止しました。':e.message);}
    finally{this.working=false;this.controls();this.bridge.refresh();}
  }
  drawReport(){
    const r=this.report,p=positionAt(r.root.initial,r.root.moves);$('coach-selection').textContent='あなたの候補：'+moveLabel(p,r.chosen);
    const box=$('coach-report');box.replaceChildren();
    const comparison=el('div',undefined,'coach-comparison');comparison.append(el('p','今回の最善候補 '+moveLabel(p,r.bestMove)+'　'+scoreLabel(r.best.score)),el('p','あなたの候補 '+moveLabel(p,r.chosen)+'　'+scoreLabel(r.defense.score)),el('small',sideName(r.side)+'視点。探索時間ごとの暫定評価です。'));
    box.append(comparison);
    for(const branch of reportBranches(r)){
      const section=el('details',undefined,'coach-line');section.open=branch.id==='defense'||branch.id==='assumption';section.append(el('summary',branch.title+'　'+scoreLabel(branch.score)));
      const chips=el('div',undefined,'move-chips');
      const start=el('button','開始局面');start.type='button';start.onclick=()=>this.bridge.showLine(r.root,branch.pv,0);chips.append(start);
      branch.evidence.moves.forEach((move,i)=>{const b=el('button',(i+1)+'. '+move.label);b.type='button';b.onclick=()=>this.bridge.showLine(r.root,branch.pv,i+1);chips.append(b);});
      const future=el('button','この2手の先を相談','accent-button coach-future');future.type='button';future.disabled=branch.pv.length<2;future.dataset.tooShort=branch.pv.length<2?'true':'false';future.onclick=()=>this.follow(branch);
      const outcomes=lineOutlook(r.root,branch,this.learnerSide),grid=el('div',undefined,'coach-outlooks');
      for(const [key,title,empty]of[['hope','嬉しい展開の材料','この短い読み筋では具体例を確認できませんでした。'],['worry','困る展開の注意点','この短い読み筋では具体例を確認できませんでした。安全を保証するものではありません。']]){
        const column=el('div',undefined,'coach-outlook '+key);column.append(el('h3',title));
        if(!outcomes[key].length)column.append(el('p',empty));
        for(const item of outcomes[key]){column.append(el('p',item.text));const view=el('button',item.ply+'手先の盤面を見る');view.type='button';view.onclick=()=>this.bridge.showLine(r.root,branch.pv,item.ply);column.append(view);}
        grid.append(column);
      }
      section.append(chips,future,el('p',branch.evidence.summary,'micro'),el('p',sideName(outcomes.side)+'の立場。以下は、この手順どおりに進んだ場合の材料です。','micro'),grid);box.append(section);
    }
    box.append(el('p','駒取りや王手だけで手の良し悪しは決まりません。「この2手の先を相談」で次の一手を考え、「一つ前の相談へ」で別の応手と比べられます。','micro'));
  }
}
function moveTokensPresent(s){return /[1-9１-９][一二三四五六七八九1-9１-９]|[1-9][a-i]/.test(s);}
