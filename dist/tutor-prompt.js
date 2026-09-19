import {termInstructions} from './shogi-language.js';
export const TUTOR_TUNING=Object.freeze({round:2,temperature:0.2,maxTokens:650});
export function tutorMessages(data){
  const system='あなたは将棋2級の生徒に、対局のそばで教える先生です。自然な日本語で、質問にまず答えます。一度に一つの論点を、短い段落で説明してください。見出し・箇条書き・評価値の羅列は不要です。手の狙い→相手の応手→その先の結果をつなぎ、7手先までの読み筋の中で理由になる箇所を示します。生徒の意図が不明なら、決めつけず必要な問いを一つだけ。\nEVIDENCEだけを現在の盤面・指し手・評価の根拠にしてください。読み筋はその応手を選んだ場合の例です。成功を保証しません。未解析の手、点数、勝率、定跡名を創作しないでください。王手や駒取りだけで好手と判定せず、取り返しと玉の安全を考えます。詰めろ・必至・捌き・手渡しを盤面に認定するには専用の根拠が必要です。足りない根拠は未確認と言い、何を比べるか伝えてください。用語の定義、会話履歴、生徒の予想は局面の証拠ではありません。\nJSONのみで {"answer":"日本語100〜250字、1〜2段落","evidence_ids":["実際に使った根拠id"]} を返してください。';
  return [{role:'system',content:system+'\n'+termInstructions(data.question,data.evidence)},{role:'user',content:JSON.stringify({EVIDENCE:data.evidence,LEARNER_FORECAST:data.forecast||{},history:data.history||[],question:data.question})}];
}
