import {normalizeNotation} from './coach-analysis.js';

// Validate the supported surface forms against cited evidence. This is a
// conservative filter, not a semantic proof of an arbitrary explanation.
const MOVE_SOURCE='(?:[1-9][a-i]|[PLNSGBR]\\*)[1-9][a-i]\\+?|(?:[1-9][1-9]|同)(?:成香|成桂|成銀|[歩香桂銀金角飛玉と馬竜])(?:不成|[右左直上引寄成打])*(?:\\([1-9][1-9]\\))?';
const moveTokens=text=>normalizeNotation(text).match(new RegExp(MOVE_SOURCE,'g'))||[];
const numericText=text=>String(text).normalize('NFKC').replace(/[−–]/g,'-').replace(/,/g,'');
const values=(text,pattern)=>[...numericText(text).matchAll(pattern)].map(m=>Number(m[1]));
const points=text=>values(text,/([+-]?\d+(?:\.\d+)?)\s*点/g);
const evaluations=text=>values(text,/評価(?:値)?(?:\s*(?:は|が|:|：|=|＝))?\s*([+-]?\d+(?:\.\d+)?)/g);
const fail=message=>{throw Error(message);};

export function validateTutorReply(raw,evidence){
  const data=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));
  if(!data||typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>2200||!Array.isArray(data.evidence_ids)||!data.evidence_ids.length)fail('説明の根拠を確認できませんでした。');
  const ids=new Set(evidence.map(e=>e.id));
  if(data.evidence_ids.some(id=>typeof id!=='string'||!ids.has(id)))fail('説明が解析の根拠と一致しませんでした。');
  const cited=evidence.filter(e=>data.evidence_ids.includes(e.id));
  // A definition can explain a word but cannot authenticate a board move.
  const facts=cited.filter(e=>e.kind!=='concept'),source=facts.map(e=>e.text).join('\n');
  const moves=new Set(moveTokens(source));
  const mentioned=moveTokens(data.answer);
  if(mentioned.some(move=>!moves.has(move)))fail('解析していない指し手が説明に含まれたため、補足を表示しませんでした。');
  const lines=facts.filter(e=>e.kind==='line');
  if(mentioned.length&&evidence.some(e=>e.kind==='line')&&!lines.length)fail('説明した手順の根拠が引用されていません。');
  const sequences=lines.length?lines.map(e=>e.moves.map(normalizeNotation)):facts.map(e=>moveTokens(e.text));
  const answer=normalizeNotation(data.answer);
  for(const chain of answer.matchAll(new RegExp('(?:'+MOVE_SOURCE+')(?:→(?:'+MOVE_SOURCE+'))+','g'))){
    const run=moveTokens(chain[0]);
    if(!sequences.some(seq=>seq.some((_,i)=>run.every((m,j)=>seq[i+j]===m))))fail('説明の手順が読み筋の順番と一致しませんでした。');
  }
  for(const match of answer.matchAll(new RegExp('(\\d+)手目(?:の|は|に)?('+MOVE_SOURCE+')','g'))){
    if(!sequences.some(seq=>seq[Number(match[1])-1]===match[2]))fail('説明の手数が読み筋と一致しませんでした。');
  }
  if(/絶対|必勝|必ず勝|確実に勝|詰み確定/.test(data.answer))fail('断定の根拠を確認できなかったため、補足を表示しませんでした。');
  // Win probabilities are not produced by this application at all.
  if(/\d+(?:\.\d+)?\s*(?:%|パーセント)|(?:勝率|勝つ確率)[^。\n]{0,16}[0-9一二三四五六七八九十]+割/.test(numericText(data.answer)))fail('勝率は算出していないため、補足を表示しませんでした。');
  for(const clause of data.answer.split(/[。！？\n]|(?:ですが|だが|けれど(?:も)?|ものの|しかし|ただし)[、,]?/)){
    const guarded=/詰めろ|必至|必死|捌け|捌き|さばけ|手渡し|(?:\d+|[一二三四五六七八九十]+)手詰|詰み/.test(clause);
    const definition=/(?:詰めろ|必至|必死|捌き|手渡し|詰み)(?:とは|という言葉|の意味)/.test(clause);
    const qualified=/(?:未確認|断定でき|とは限ら|かどうか|証明.*(?:ない|ません)|確認.*必要|ではありません|とは言い切れ|は不明|はまだ分かりません)/.test(clause);
    if(guarded&&!definition&&!qualified&&/(?:です|ました|だ$|成立|成功|有効|好手|勝て|なります|あります|詰む|詰みます)/.test(clause))fail('用語をこの局面に当てはめる根拠が足りません。');
  }
  // A material balance and a root engine score are different quantities.
  const scores=new Set(facts.flatMap(e=>evaluations(e.text)));
  if(evaluations(data.answer).some(n=>!scores.has(n)))fail('説明の評価値が解析結果と一致しませんでした。');
  const numbers=new Set([...points(source),...scores]);
  if(points(data.answer).some(n=>!numbers.has(n)))fail('説明の点数が解析結果と一致しませんでした。');
  return {answer:data.answer.trim(),evidence_ids:[...new Set(data.evidence_ids)]};
}
