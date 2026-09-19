import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOGI_TERMS,selectTerms,termInstructions,conceptEvidence} from '../dist/shogi-language.js';
import {START} from '../dist/core.js';
import {tutorMessages} from '../dist/tutor-prompt.js';
import {selectTutorEvidence,validateTutorReply} from '../dist/tutor.js';
test('Terms are selected by the learner question, not dumped into every answer',()=>{
  assert.equal(selectTerms('この局面は手渡しでいい？')[0].term,'手渡し');
  assert.equal(selectTerms('なぜ？').length,0);
  assert(selectTerms('攻めと受けを比較したい').length===2);
  assert(SHOGI_TERMS.length>=12);
  assert.match(termInstructions('手渡し'),/証拠ではない/);
});
test('Replies cannot borrow uncited moves or turn a glossary into a proof',()=>{
  const evidence=[{id:'position',text:'先手の局面'},{id:'defense',text:'７六歩 → ３四歩'}];
  const reply=(answer,evidence_ids=['position'])=>JSON.stringify({answer,evidence_ids});
  assert.throws(()=>validateTutorReply(reply('７六歩がよいです。'),evidence));
  assert.throws(()=>validateTutorReply(reply('この手は手渡しの好手です。'),evidence));
  assert.throws(()=>validateTutorReply(reply('必至です。'),evidence));
  assert.throws(()=>validateTutorReply(reply('これで捌けました。成功です。'),evidence));
  assert.doesNotThrow(()=>validateTutorReply(reply('手渡しが有効かどうかは未確認です。'),evidence));
  assert.doesNotThrow(()=>validateTutorReply(reply('７六歩のあと、相手の３四歩を確認しましょう。',['defense']),evidence));
});
test('The teaching evidence keeps all seven moves before repetitive commentary',()=>{
  const moves=['７六歩','３四歩','２六歩','８四歩','２五歩','８五歩','７八金'];
  const evidence=[{id:'position',text:'先手の局面'},{id:'teacher',text:'長い説明。'.repeat(100)},{id:'defense',kind:'line',title:'厳しい応手',moves,resultText:'先手視点。条件付きの読み。',text:'unused'}];
  const packed=selectTutorEvidence(evidence,'攻めを考えたい',{style:'teacher'});
  assert.equal(packed[1].id,'defense');for(const m of moves)assert(packed[1].text.includes(m));
  assert(packed.reduce((s,e)=>s+e.text.length,0)<=1100);
});
test('A quiet move or an exchange is not proof of handover or successful development',()=>{
  assert.deepEqual(conceptEvidence({initial:START,moves:[]},{pv:['1g1f','1c1d']}),[]);
  const items=conceptEvidence({initial:START,moves:['7g7f','3c3d']},{pv:['8h2b+','3a2b']});
  assert(!items.some(e=>e.terms.includes('捌き')||e.terms.includes('手渡し')));
});
test('Teacher prompt keeps seven-ply reasoning, uncertainty and learner intent',()=>{
  const messages=tutorMessages({question:'受けたら？',evidence:[{id:'position',text:'後手の局面'}]});
  assert.match(messages[0].content,/7手先/);assert.match(messages[0].content,/決めつけず/);
  assert.match(messages[0].content,/専用の根拠/);assert.match(messages[1].content,/後手/);
});
