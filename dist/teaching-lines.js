import {positionAt,checkedPV,recordAt,statusOfRecord,sideName} from './core.js';
import {lineEvidence,scoreGap} from './coach-analysis.js';

export const MIN_TEACHING_PLIES=7;
export function teachingBranches(r){
  if(r.teaching?.lines)return r.teaching.lines;
  return [r.defense,r.chosen!==r.bestMove?r.best:null,r.opportunity,r.assumption].filter(Boolean);
}
export function teachingReady(r){return !!r?.teaching?.complete&&r.teaching.minPlies>=MIN_TEACHING_PLIES;}

// Extending a PV means another real search at its endpoint, never filling it
// with arbitrary legal moves. Keep the original root score; the appended line
// is a conditional continuation and is not a new root-depth/score claim.
export async function prepareTeaching(engine,source,{time=source.time||2000,check=()=>{},onProgress=()=>{}}={}){
  check();const r=structuredClone(source),minimum=MIN_TEACHING_PLIES;
  const used=new Set(),lines=[];
  const add=(b,title)=>{if(!b||lines.length>=4)return;const key=b.pv.slice(0,2).join(' ');if(used.has(key))return;used.add(key);lines.push({...b,title});};
  add(r.defense,'厳しく応じられたら');
  if(r.chosen!==r.bestMove)add(r.best,'最善候補を選んだら');
  add(r.assumption,'自分が想定した応手なら');add(r.opportunity,'相手が狙いを許したら');
  const replies=r.verification?.replies||r.replyExamples||[];
  for(const b of replies){if(lines.length>=3)break;add(b,'相手が別の受け方をしたら');}
  const candidates=r.verification?.candidates||[];
  for(const b of candidates){if(lines.length>=3)break;add(b,'別の候補を選んだら');}
  if(lines.length<3)add(r.caution,'別の候補を選んだら');
  const completed=[];
  for(const [index,original]of lines.entries()){
    check();let pv=checkedPV(positionAt(r.root.initial,r.root.moves),original.pv).map(m=>m.usi),terminal=null,unavailable=false;
    const segments=[];
    const record=recordAt(r.root.initial,r.root.moves);
    const advance=usi=>{const move=record.position.createMoveByUSI(usi);if(!move||!record.append(move))throw Error('読み筋の合法性を確認できませんでした。');return statusOfRecord(record);};
    // Stop even if a supplied PV legally continues after a repetition result.
    for(let n=1;n<=pv.length;n++){terminal=advance(pv[n-1]);if(terminal){pv=pv.slice(0,n);break;}}
    while(pv.length<minimum&&!terminal){
      check();onProgress((index+1)+'つ目の展開を、7手先まで読んでいます…（現在'+pv.length+'手）');
      const root={initial:r.root.initial,moves:[...r.root.moves,...pv]},p=positionAt(root.initial,root.moves);
      const result=await engine.search(root.initial,root.moves,{time:Math.min(3000,Math.max(1000,time)),multipv:1});check();
      const info=result.infos.find(i=>i.rank===1&&i.pv.length&&checkedPV(p,i.pv).length===i.pv.length);
      if(!info){unavailable=true;break;}
      const from=pv.length;
      for(const item of checkedPV(p,info.pv)){
        pv.push(item.usi);terminal=advance(item.usi);
        if(terminal||pv.length>=minimum)break;
      }
      segments.push({from,plies:pv.length-from,depth:info.depth});
    }
    const b={...original,pv,evidence:lineEvidence(r.root,pv,Math.max(minimum,12)),reading:{minPlies:minimum,complete:pv.length>=minimum||!!terminal,terminal,segments,unavailable}};
    completed.push(b);
    if(['defense','best','opportunity','assumption','caution'].includes(b.id))r[b.id]=b;
    if(b.id==='defense'&&r.chosen===r.bestMove)r.best={...b,id:'best',title:r.best.title};
  }
  r.teaching={minPlies:minimum,complete:completed.every(b=>b.reading.complete),lines:completed};check();return r;
}

export function teachingComparison(r){
  const lines=teachingBranches(r);if(!r.teaching||lines.length<2)return '';
  const example=lines.find(b=>b.pv[0]===r.chosen&&b.pv[1]!==r.defense.pv[1])||lines.find(b=>b.pv[0]!==r.chosen);
  if(!example)return '';
  const moves=example.evidence.moves,reply=moves[1]?.label,first=moves[0]?.label,gap=scoreGap(example.score,r.defense.score),who=sideName(r.side);
  const lead=example.pv[0]===r.chosen?'相手が'+reply+'と応じる展開も比べました。':first+'を選ぶ展開も比べました。';
  const assessment=gap===null?'詰みや評価の揺れを含むため、点差では決めず手順を見てみましょう。':Math.abs(gap)<100?'評価の差は小さいので、進んだ盤面でどちらが指しやすいか考えてみましょう。':gap>0?'こちらは'+who+'から見て約'+Math.round(gap)+'点よい評価ですが、相手がこの順を選ぶとは限りません。':'こちらは'+who+'から見て約'+Math.round(-gap)+'点低い評価です。どこで違いが出るか、7手先までたどってみましょう。';
  return lead+assessment;
}
