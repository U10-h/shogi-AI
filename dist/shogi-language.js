import {positionAt,checkedPV,Square} from './core.js';
// Definitions are authored summaries, not copied lesson text or a book database.
// Sources and limits of automatic recognition: docs/dialogue-tuning.md.
export const SHOGI_TERMS=Object.freeze([
  {term:'攻め',meaning:'相手の駒や玉に働きかけ、応対を求める進め方。攻めが続くかは相手の応手込みで読む。',ask:'何を実現したい攻めですか？'},
  {term:'受け',meaning:'相手の狙いを防ぐ、弱める、かわすこと。駒を引く手だけを指す言葉ではない。',ask:'相手のどの狙いを防ぎたいですか？'},
  {term:'手渡し',meaning:'すぐには仕掛けず、相手の出方を見て次の方針を選ぶ考え方。単なる手番交代やパスではない。',ask:'相手に何を指してもらい、その後どう動きたいですか？'},
  {term:'手待ち',meaning:'形を大きく崩さずに待つこと。待っている間に相手だけが得をしないか確かめる。'},
  {term:'仕掛け',meaning:'駒をぶつけるなどして具体的な戦いを始めること。準備の手とは区別する。'},
  {term:'捌き',meaning:'駒の交換などを通じて攻め駒を働かせること。交換できただけで成功とは決めない。'},
  {term:'手抜き',meaning:'相手が働きかけた場所への直接の応対を省くこと。放置した狙いが間に合うかを読む。'},
  {term:'駒得',meaning:'駒の交換や取り合いの結果、駒の収支で得をすること。形勢全体の優劣とは別。'},
  {term:'駒損',meaning:'駒の取り合いの収支で損をすること。攻めや玉の安全で補えるかは別に比べる。'},
  {term:'王手',meaning:'相手玉に駒の利きを当てること。王手をかけられた側は解消する必要がある。'},
  {term:'合駒',meaning:'飛車・角・香などの利きと玉の間に駒を置いて王手を防ぐこと。盤上の駒を動かす場合もある。'},
  {term:'詰めろ',meaning:'放置すると次に詰ます手順がある状態。王手や高い評価値だけでは判定できない。'},
  {term:'必至',meaning:'詰めろを防ぐ手段がない状態。詰み筋一つを見つけるだけでは確認できない。'},
  {term:'突き捨て',meaning:'歩を突き、相手に取らせること。空いた筋などをその後どう使うかが論点。'},
  {term:'遊び駒',meaning:'局面の戦いに十分参加できていない駒。利きの数が少ないだけでは決めない。'}
]);
export function selectTerms(question,evidence=[]){
  const matches=SHOGI_TERMS.filter(x=>question.includes(x.term));
  if(!matches.length)for(const item of evidence.filter(e=>e.kind==='concept'))for(const term of item.terms||[]){const found=SHOGI_TERMS.find(t=>t.term===term);if(found&&!matches.includes(found))matches.push(found);}
  return matches.slice(0,2);
}
export function termInstructions(question,evidence=[]){
  const terms=selectTerms(question,evidence);
  return terms.length?'用語の説明（局面の証拠ではない）：'+terms.map(x=>x.term+'＝'+x.meaning).join(' ')+' この局面で成立すると断言せず、読み筋と成立条件を結び付ける。':'';
}

// Conservative, replayed observations. Quietness is never a 手渡し detector,
// and a check never proves a mating threat, inevitability, or a good attack.
export function conceptEvidence(root,branch,side=positionAt(root.initial,root.moves).color){
  const p=positionAt(root.initial,root.moves),items=[];
  for(const [index,item]of checkedPV(p,branch.pv).slice(0,12).entries()){
    const m=p.createMoveByUSI(item.usi),own=p.color===side,inCheck=p.checked;
    p.doMove(m);
    if(own&&inCheck)items.push({id:'concept_receive_'+index,kind:'concept',terms:['受け'],text:(index+1)+'手目の'+item.label+'は王手を解消する受け。局面全体が安全になったとは限らない。'});
    if(own&&p.checked)items.push({id:'concept_check_'+index,kind:'concept',terms:['王手','攻め'],text:(index+1)+'手目の'+item.label+'は王手。攻めを考える材料だが、その後の受けと取り返しも読む。'});
    if(inCheck&&!(m.from instanceof Square))items.push({id:'concept_block_'+index,kind:'concept',terms:['合駒'],text:(index+1)+'手目の'+item.label+'は持ち駒を打って王手を防ぐ合駒。'});
  }
  return items.slice(0,3);
}
