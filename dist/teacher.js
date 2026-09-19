import {positionAt,moveLabel} from './core.js';
import {positionKey,resolveMove,questionIntent,investigate,reportEvidence} from './coach-analysis.js';
import {teachingEnabled,sameLesson,reviewPlayedMove,teacherComment,teacherAnswer,teacherEvidence,goalLabels,movePoint} from './teacher-analysis.js';

import {belongsToGame} from './background-coach.js';

const $=id=>document.getElementById(id);
const abort=()=>new DOMException('指導を中止しました。','AbortError');
const rootOf=g=>({initial:g.initial,moves:[...g.moves]});

// A lesson belongs to an actual played move. Browsing a variation never changes
// its checkpoint, and only an explicit continue/retry releases the game.
export class Teacher {
  constructor(bridge,engine,tutor){
    this.bridge=bridge;this.engine=engine;this.tutor=tutor;this.lesson=null;this.working=false;this.job=0;this.gameId=null;this.history=[];this.progress='';this.observed=null;this.notice=null;this.watchStatus='対局を見守っています';this.lastPraise=-8;
    $('teacher-check').onclick=()=>this.openObserved();
    $('teacher-ask').onsubmit=e=>{e.preventDefault();const text=$('teacher-question').value.trim();if(text)this.ask(text);};
    $('teacher-continue').onclick=()=>this.continue();$('teacher-retry').onclick=()=>this.retry();
    $('teacher-more').onclick=()=>this.ask('なぜこの手がよい、または気になるのでしょうか？');
    $('teacher-look').onclick=()=>this.explore();$('teacher-origin').onclick=()=>this.origin();
    $('teacher-reanalyze').onclick=()=>this.review(this.lesson.root,this.lesson.played,true);
    $('teacher-stop').onclick=()=>this.cancel();
    $('teacher-intents').replaceChildren();
    for(const [goal,label] of Object.entries(goalLabels)){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>this.ask(label,goal);$('teacher-intents').append(button);
    }
  }
  observe(report,{gameId,concern}){
    const g=this.bridge.game();if(gameId!==g.id||this.active||!belongsToGame(report.root,report.chosen,g))return;
    const item={report,gameId};
    // Keep an unresolved warning available even if a later quiet move finishes.
    if(concern||!this.notice)this.observed=item;
    if(concern){
      this.notice=item;const c=teacherComment(report);
      this.message('assistant',(report.root.moves.length+1)+'手目のことですが、'+c.text);
    }else if(!this.notice&&report.root.moves.length-this.lastPraise>=8&&teacherComment(report).grade==='good'&&movePoint(report)){
      this.lastPraise=report.root.moves.length;this.message('assistant',(report.root.moves.length+1)+'手目、'+teacherComment(report).text);
    }
    this.bridge.refresh();
  }
  async openObserved(){
    const item=this.observed;if(!item||this.opening||this.working||this.active||this.bridge.dialogueBusy?.())return;
    this.opening=true;this.sync();
    try{
      await this.bridge.prepare();const g=this.bridge.game();
      if(g.id!==item.gameId||!belongsToGame(item.report.root,item.report.chosen,g))return;
      this.bridge.markPending(item.report.root.moves.length+1,item.report.chosen);
      this.opening=false;await this.review(item.report.root,item.report.chosen,true,item.report);
    }finally{this.opening=false;this.bridge.refresh();}
  }
  get active(){return !!this.lesson;}
  get locked(){return this.working||Boolean(this.bridge.locked?.());}
  sync(){
    const g=this.bridge.game();
    if(this.gameId!==g.id){this.invalidate();this.gameId=g.id;this.history=[];this.observed=null;this.notice=null;this.lastPraise=-8;$('teacher-chat').replaceChildren();}
    if(this.lesson&&!sameLesson(this.lesson,g)){this.invalidate();this.message('assistant','本対局の局面が変わりました。次に指した手から、また一緒に考えましょう。');}
    const enabled=teachingEnabled(g),l=this.lesson;
    if(this.observed&&!belongsToGame(this.observed.report.root,this.observed.report.chosen,g)){this.observed=null;this.notice=null;}
    $('teacher-welcome').hidden=this.history.length>0;
    $('teacher-welcome').textContent=enabled?(g.backgroundCoaching===false?'見守りを休んでいます。気になる局面は「自分で候補を相談する」から一緒に考えられます。':'どうぞ、自分のペースで指してください。気になる手があれば声をかけます。立ち止まって考えたいときは、一緒に盤面を見てみましょう。'):'実戦モードです。対局中の助言はありません。先生と指すには、設定で「先生と学ぶ」を選んでください。';
    $('teacher-status').textContent=l?(this.progress|| (l.report?'指した手を一緒に確認中 · 時計は停止':'講評を待っています · 時計は停止')):enabled?(g.backgroundCoaching===false?'見守りはお休み中です':!this.bridge.running?.()?'対局を始めると、先生が見守ります':this.watchStatus):'実戦練習';
    $('teacher-context').textContent=l?'確認する手：'+(l.root.moves.length+1)+'手目 '+moveLabel(positionAt(l.root.initial,l.root.moves),l.played)+' ／ 本対局は'+l.checkpoint.moves.length+'手目'+(l.discussionRoot&&positionKey(l.discussionRoot)!==positionKey(l.root)?' ／ 検討 '+l.discussionRoot.moves.length+'手目':''):'';
    $('teacher-lesson').hidden=!l;
    $('teacher-check').hidden=!!l||!enabled||!this.observed;$('teacher-check').disabled=this.working||this.opening||!!this.bridge.dialogueBusy?.();
    $('teacher-check').textContent=this.observed?(this.observed.report.root.moves.length+1)+'手目を先生と確認':'先生と確認';
    $('teacher-retry').textContent=l?(l.root.moves.length+1)+'手目の前から指し直す':'指し直す';
    $('teacher-question').disabled=!l||this.locked||!l.report;
    for(const id of ['teacher-send','teacher-more','teacher-look','teacher-origin'])$(id).disabled=!l||this.locked||!l.report;
    const branch=l?.discussionReport?.[l.discussionBranch||'defense'];
    $('teacher-look').disabled=!l||this.locked||!branch||branch.pv.length<2;
    $('teacher-look').textContent=l?.discussionRoot&&positionKey(l.discussionRoot)!==positionKey(l.root)?'さらに2手先を見る':'相手の応手まで盤面で見る';
    $('teacher-origin').hidden=!l?.discussionRoot||positionKey(l.discussionRoot)===positionKey(l.root);
    $('teacher-continue').disabled=!l||this.locked;$('teacher-retry').disabled=!l||this.locked;
    $('teacher-continue').textContent=l?.result?'この一手の確認を終える':l?.report?'本対局を続ける':'本対局に戻る';
    $('teacher-intents').hidden=!l?.awaitingIntent||!l.report||positionKey(l.discussionRoot||l.root)!==positionKey(l.root);
    for(const b of $('teacher-intents').querySelectorAll('button'))b.disabled=this.locked;
    $('teacher-reanalyze').hidden=!l||!!l.report||this.working;$('teacher-reanalyze').disabled=this.locked;
    $('teacher-stop').hidden=!this.working;
  }
  message(role,text){
    const row=document.createElement('div');row.className='teacher-message '+role;
    const who=document.createElement('span');who.className='coach-speaker';who.textContent=role==='user'?'あなた':'先生';
    const body=document.createElement('p');body.textContent=text;row.append(who,body);$('teacher-chat').append(row);
    while($('teacher-chat').children.length>14)$('teacher-chat').firstChild.remove();
    this.history.push({role,text});this.history=this.history.slice(-14);$('teacher-chat').scrollTop=$('teacher-chat').scrollHeight;
  }
  invalidate(){this.job++;if(this.working){this.engine.stop();this.tutor?.interrupt();}this.working=false;this.lesson=null;this.progress='';}
  cancel(){this.job++;this.engine.stop();this.tutor?.interrupt();this.working=false;this.progress='講評を中止しました · 時計は停止';this.bridge.refresh();}
  restore(){
    if(this.active)return;
    const g=this.bridge.game(),marker=g.teacherPending;
    if(!teachingEnabled(g)||!marker||!Number.isInteger(marker.ply)||marker.ply<1||marker.ply>g.moves.length||marker.move!==g.moves[marker.ply-1]||!g.moves.length)return;
    const root={initial:g.initial,moves:g.moves.slice(0,marker.ply-1)};
    if(positionAt(root.initial,root.moves).color!==g.human)return;
    this.lesson={gameId:g.id,checkpoint:rootOf(g),result:g.result,root,played:marker.move,report:null};
    this.message('assistant','前回指した一手の講評が途中でした。「講評を再開」で一緒に確認できます。');this.sync();
  }
  async review(root,played,restart=false,cached=null){
    if(this.locked)return;
    const g=this.bridge.game();if(!teachingEnabled(g))return;
    this.gameId=g.id;const id=++this.job;
    const lesson=this.lesson={gameId:g.id,checkpoint:rootOf(g),result:g.result,root:structuredClone(root),played,report:null,awaitingIntent:false};
    this.working=true;this.progress='指した手と、相手の応手を確かめています…';
    if(!restart)this.message('user',moveLabel(positionAt(root.initial,root.moves),played)+' と指しました。');
    $('teacher-question').value='';this.bridge.show();this.bridge.refresh();
    try{
      const report=cached||await this.bridge.run(async hostCheck=>{
        const check=()=>{hostCheck();if(id!==this.job||!sameLesson(lesson,this.bridge.game()))throw abort();};check();
        const r=await reviewPlayedMove(this.engine,root,played,{time:this.bridge.time(),check,onProgress:text=>{check();this.progress=text;this.sync();}});check();return r;
      });
      if(id!==this.job||!sameLesson(lesson,this.bridge.game()))return;
      lesson.report=report;lesson.discussionRoot=structuredClone(root);lesson.discussionReport=report;
      this.observed={report,gameId:g.id};
      lesson.comment=teacherComment(report);lesson.awaitingIntent=!!lesson.comment.question;
      this.message('assistant',lesson.comment.text+(lesson.comment.question?'\n\n'+lesson.comment.question:''));
      this.bridge.report(report);this.progress='';
    }catch(e){if(id===this.job){this.progress=e.name==='AbortError'?'講評を中止しました · 時計は停止':'講評を取得できませんでした · 時計は停止';if(e.name!=='AbortError')this.message('assistant',e.message+' 指した手は保存されています。再開するか、指し直してみましょう。');}}
    finally{if(id===this.job){this.working=false;this.bridge.refresh();}}
  }
  async ask(text,goal=null){
    const l=this.lesson;if(!l?.report||this.locked||!sameLesson(l,this.bridge.game()))return;
    const id=++this.job;this.working=true;$('teacher-question').value='';this.message('user',text);this.bridge.refresh();
    try{
      const view=this.bridge.current(),isStudy=this.bridge.isStudy();
      let root=isStudy?view:l.discussionRoot||l.root,r=l.discussionReport||l.report;
      const intent=questionIntent(text);
      let found=resolveMove(positionAt(root.initial,root.moves),text),reply=null;
      if(intent==='reply'&&positionKey(root)===positionKey(r.root)){
        const after={initial:root.initial,moves:[...root.moves,r.chosen]};
        found=resolveMove(positionAt(after.initial,after.moves),text);
        if(found.kind==='move')reply=found.usi;
      }
      if(found.kind==='illegal'||found.kind==='ambiguous'){this.message('assistant',found.message||'指す駒と移動先を、もう少し具体的に教えてください。');return;}
      const isIntent=positionKey(root)===positionKey(l.root)&&(!!goal||l.awaitingIntent&&found.kind==='none'&&!/[?？]|なぜ|どう|ですか|ますか|何を|最善|読み/.test(text));
      if(isIntent){l.goal=goal?goalLabels[goal]:text.slice(0,160);l.awaitingIntent=false;}
      if(intent==='future'){
        this.message('assistant','「相手の応手まで盤面で見る」で2手進められます。進んだ局面でも、同じ欄から次の手や狙いを質問できます。');return;
      }
      if(found.kind==='move'||positionKey(root)!==positionKey(r.root)||['deeper','verify','reply'].includes(intent)){
        this.progress='質問した局面の続きを確かめています…';this.sync();
        const chosen=reply?r.chosen:found.kind==='move'?found.usi:positionKey(root)===positionKey(r.root)?r.chosen:null;
        r=await this.bridge.run(async hostCheck=>{
          const check=()=>{hostCheck();if(id!==this.job||!sameLesson(l,this.bridge.game()))throw abort();};check();
          const result=await investigate(this.engine,root,chosen,{time:this.bridge.time(),rigor:['deeper','verify'].includes(intent)?'deep':'standard',reply,check});check();return result;
        });
        if(id!==this.job||!sameLesson(l,this.bridge.game()))return;
        l.discussionRoot=structuredClone(root);l.discussionReport=r;this.bridge.report(r);
      }
      l.discussionBranch=intent==='reply'&&r.assumption?'assumption':intent==='best'?'best':intent==='opportunity'&&r.opportunity?'opportunity':'defense';
      const options={text:isIntent?text:'',goal,intent:isIntent?'explain':intent,side:this.bridge.game().human,round:l.round||0};
      let answer=teacherAnswer(r,options);l.round=(l.round||0)+1;
      if(positionKey(r.root)!==positionKey(l.root))answer=r.root.moves.length+'手目まで進めた盤面ですね。'+answer;
      // Show one answer. A language-model response replaces the fallback rather
      // than being appended after another long explanation of the same move.
      if(this.tutor?.ready){
        this.progress='考えを聞きながら、続きを整理しています…';this.sync();
        try{
          const evidence=[{id:'teaching_focus',text:answer},...teacherEvidence(r,teacherComment(r)),...reportEvidence(r,this.bridge.game().human)];
          const result=await this.tutor.answer(text,evidence,this.history.slice(0,-1),{}, {style:'teacher'});
          if(id!==this.job||!sameLesson(l,this.bridge.game()))return;
          answer=result.answer;
        }catch(e){if(id!==this.job)return;}
      }
      this.message('assistant',answer);

    }catch(e){if(id===this.job&&e.name!=='AbortError')this.message('assistant',e.message);}
    finally{if(id===this.job){this.working=false;this.progress='';this.bridge.refresh();}}
  }
  async explore(){
    const l=this.lesson,r=l?.discussionReport,b=r?.[l.discussionBranch||'defense'];if(this.locked||!b||b.pv.length<2)return;
    const id=++this.job;this.working=true;this.bridge.refresh();
    try{
      await this.bridge.showLine(r.root,b.pv,2);
      if(id!==this.job||!sameLesson(l,this.bridge.game()))return;
      l.discussionRoot={initial:r.root.initial,moves:[...r.root.moves,...b.pv.slice(0,2)]};l.discussionReport=null;
      this.message('assistant',b.evidence.moves.slice(0,2).map(m=>m.label).join(' → ')+' と進めました。本対局は止めたままです。\n\nここから、どうなれば嬉しくて、何をされると困りますか？ 考えた次の手も聞かせてください。');
      this.bridge.show(false);
    }catch(e){if(id===this.job)this.message('assistant',e.message);}
    finally{if(id===this.job){this.working=false;this.bridge.refresh();}}
  }
  async origin(){
    const l=this.lesson;if(!l||this.locked)return;
    await this.bridge.showLine(l.root,[l.played],1);if(!sameLesson(l,this.bridge.game()))return;
    l.discussionRoot=structuredClone(l.root);l.discussionReport=l.report;l.discussionBranch='defense';this.bridge.actualView();this.bridge.report(l.report);this.bridge.refresh();
    this.message('assistant','本対局で指した '+moveLabel(positionAt(l.root.initial,l.root.moves),l.played)+' の話に戻りました。');
  }
  note(l,action){this.bridge.note?.({ply:l.root.moves.length+1,move:l.played,grade:l.comment?.grade||'unreviewed',goal:l.goal||'',note:(l.comment?.text||'講評なし').slice(0,400),action});}
  async continue(){
    const l=this.lesson;if(!l||this.locked||!sameLesson(l,this.bridge.game()))return;
    this.note(l,'continue');this.notice=null;this.invalidate();this.message('assistant',l.result?'この一手の確認を終えました。棋譜を見ながら振り返ることもできます。':'では、続けてみましょう。');
    await this.bridge.resume(l);this.bridge.refresh();
  }
  async retry(){
    const l=this.lesson;if(!l||this.locked||!sameLesson(l,this.bridge.game()))return;
    this.note(l,'retry');this.observed=null;this.notice=null;this.invalidate();await this.bridge.retry(l);this.message('assistant','指す前の盤面に戻しました。相手の応手も思い浮かべて、もう一手選んでみましょう。');this.bridge.refresh();
  }
}
