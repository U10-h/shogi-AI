import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOGI_TERMS,selectTerms,termInstructions} from '../dist/shogi-language.js';
import {tutorMessages} from '../dist/tutor-prompt.js';
test('Terms are selected by the learner question, not dumped into every answer',()=>{
  assert.equal(selectTerms('この局面は手渡しでいい？')[0].term,'手渡し');
  assert.equal(selectTerms('なぜ？').length,0);
  assert(selectTerms('攻めと受けを比較したい').length===2);
  assert(SHOGI_TERMS.length>=12);
  assert.match(termInstructions('手渡し'),/証拠ではない/);
});
test('Teacher prompt keeps seven-ply reasoning, uncertainty and learner intent',()=>{
  const messages=tutorMessages({question:'受けたら？',evidence:[{id:'position',text:'後手の局面'}]});
  assert.match(messages[0].content,/7手先/);assert.match(messages[0].content,/決めつけず/);
  assert.match(messages[0].content,/専用の根拠/);assert.match(messages[1].content,/後手/);
});
