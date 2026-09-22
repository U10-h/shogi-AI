#!/usr/bin/env python3
"""Write the Japanese report from recorded results, no fabricated measurements."""
import json,statistics
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=R/'results/v0.15'
s=json.loads((D/'summary.json').read_text());verify=json.loads((D/'verification.json').read_text())
extreme=json.loads((D/'simd-extremes.json').read_text())
labels={'baseline':'v0.14 駒取り履歴','fast':'v0.15 fast（推奨）','lmr':'fast＋既存LMR','history':'fast＋履歴LMR'}
fast=s['fixed']['fast'];q1=s['quality']['1000'];q3=s['quality']['3000']
lines=['# v0.15：探索処理の高速化と、深さ配分の比較','',
'実験日：2026-09-22（UTC）。ユーザー添付の `shogi-search-lab.zip`（v0.14）を起点に実装・実験した。比較基準は前回推奨の駒取り履歴版。評価モデルの重みは変更していない。','',
f'**推奨はfast。** 深さ4の16局面・各3反復で、同じノード・評価値・最善手・PVを保ち、探索時間を **{(1-fast["timeRatio"])*100:.1f}%短縮（{1/fast["timeRatio"]:.2f}倍速）** した。新たな選択的枝刈りは加えていない。',
f'1秒では探索ノード数が{q1["fast"]["nodeRatio"]:.2f}倍、平均完了深さが{q1["baseline"]["meanDepth"]:.2f}→{q1["fast"]["meanDepth"]:.2f}。3秒では{q3["fast"]["nodeRatio"]:.2f}倍、{q3["baseline"]["meanDepth"]:.2f}→{q3["fast"]["meanDepth"]:.2f}となった。','',
'## 何を変えたか','',
'- NNUEの整数積和と特徴の差分更新をAVX2化。実行時にCPUを判定し、非対応環境ではスカラー計算を使う。',
'- 差分計算中に欠落駒数の変化も求め、同じ盤面を追加で再集計する処理を省いた。',
'- 手の優先順位を節点の入口で固定し、全件ソートの代わりに必要な順番だけヒープから取り出す。子探索中の履歴変化で順序がずれないようにした。',
'- 別の実験機能としてhistory-lmrを追加。PV・TT手・killer・counter・良い履歴を保護し、後順位の悪い履歴では削減量を増やす。有望なら元の深さで再探索する。','',
'NNUE公式技術資料、手順序とTTの論文、LMR・手選択の一次実装を参照した。[文献と実装の対応](RESEARCH-v0.15.md)に出典、算術上の根拠、既存ETCの制限をまとめた。','',
'## 同じ深さでの処理速度','',
'16根・深さ4・各3反復・順序回転・直列測定。局面ごとの時間中央値を合計した比。1より小さいほど速い。時間はモデル読込とプロセス起動を除く。','',
'| 方式 | 探索時間比［95%参考区間］ | ノード比 | 評価値変更 | 最善手変更 |',
'|---|---:|---:|---:|---:|']
for name in s['protocol']['names']:
 r=s['fixed'][name];lo,hi=r['timeRatio95']
 lines.append(f'| {labels[name]} | {r["timeRatio"]:.3f} ［{lo:.3f}, {hi:.3f}］ | {r["nodeRatio"]:.3f} | {r["scoreChanges"]}/16 | {r["moveChanges"]}/16 |')
lines+=['','fastは全16根でPVも一致した。LMRのノード削減には読む範囲の変更が含まれ、同じ深さの厳密探索を高速化した比とは解釈できない。','',
'開発用の既知8根・20万ノード・各1回の切り分けでは、旧版に対する時間比は、新スカラー計算0.929、SIMD＋全件ソート0.562、SIMD＋遅延ソート0.531だった。NNUE計算の改善が主な寄与と考えられる。これは反復のない補助測定で、上の新規根での反復測定とは区別する。既存aspiration併用は0.541、平均完了深さ4.50で、fastの4.50を上回らなかった。','',
'## 同じ持ち時間での深さと指し手','',
'各局面・各方式・1秒/3秒を2回ずつ測り、計256探索。全方式の選択手と教師自身の手を共通候補集合に入れ、固定YaneuraOu 6.03の深さ12で再採点した。「候補差」はその集合内の最高評価からの差で、小さいほど良い。全合法手の厳密な損失ではない。','',
'| 時間 | 方式 | 平均完了深さ | ノード比 | 平均候補差cp | 基準との差cp［95%参考区間］ | 改善/同等/悪化の根数 |',
'|---|---|---:|---:|---:|---:|---:|']
for ms in ['1000','3000']:
 for name in s['protocol']['names']:
  r=s['quality'][ms][name];lo,hi=r['deltaGap95'];counts='/'.join(map(str,r['improvedEqualWorseRoots']))
  lines.append(f'| {int(ms)//1000}秒 | {labels[name]} | {r["meanDepth"]:.2f} | {r["nodeRatio"]:.2f} | {r["meanGapCp"]:.2f} | {r["meanDeltaGapCp"]:+.2f} ［{lo:+.2f}, {hi:+.2f}］ | {counts} |')
lines+=['','改善/同等/悪化は、同じ根での2反復を平均してから判定した。反復数を独立な局面数とは数えていない。LMRの深さは選択的な深さであり、fastと同じ範囲を読んだ長さではない。','',
'## 悪化例も残した','',
'次は各方式で基準との差が最も悪かった個別測定。正の差は、その測定で基準より教師評価が低かったことを示す。','',
'| 方式 | 根ID | 時間/反復 | 基準手 → 選択手 | 教師評価の悪化cp |',
'|---|---:|---|---|---:|']
for name in ['fast','lmr','history']:
 cases=[]
 for p in (D/'quality').glob('*.json'):
  row=json.loads(p.read_text());teacher=json.loads((D/'teacher'/f'{row["id"]}.json').read_text())
  if not all(c['type']=='cp' for c in teacher['candidates']):continue
  scores={c['move']:c['score'] for c in teacher['candidates']}
  a=next(r for r in row['runs'] if r['variant']=='baseline');b=next(r for r in row['runs'] if r['variant']==name)
  cases.append((scores[a['chosenMove']]-scores[b['chosenMove']],row,a,b))
 delta,row,a,b=max(cases,key=lambda x:x[0])
 lines.append(f'| {labels[name]} | {row["id"]} | {row["ms"]//1000}秒 / {row["rep"]} | `{a["chosenMove"]}` → `{b["chosenMove"]}` | {delta:+} |')
lines+=['','読む深さが増えても、限られた探索・評価関数で選ぶ手が必ず良くなるわけではない。深さと候補差を別々に残し、悪化例を消して平均だけを報告しない。','',
'## 採用判断','',
'**標準はfast。** 元の限定静止探索と手順序を保った処理高速化を採用する。モデルの追加学習や新しい予測枝刈りは必要なかった。',
'**既存LMR・新規履歴LMRは比較可能な実験設定として残す。** より深く進む効果と、教師評価による品質を上表で確認できる。ただし同系統16局面だけで、どちらが一般的に強いか、全局対局の勝率が上がるかは確定できない。今回は対局勝率やEloを測っていない。','',
'## 検証と限界','',
f'- 既存・拡張セルフテスト：基礎115、継続探索1,274、拡張探索5,413、計6,802チェック通過。',
f'- 独立した固定上流評価器と{verify["staticPositions"]:,}局面を4評価モードで照合し、評価値の最大誤差0。',
f'- 既知21根の10万ノード探索、全件ソート/スカラー/照合モード、および3根の上位5候補を含む{verify["searchComparisons"]}件の対応比較で、値・PV・ノード・探索統計が一致。',
f'- 極端な整数重み{extreme["models"]}モデル・{extreme["pairedChecks"]}件の対照で、評価値と32中間活性が一致。符号・16ビット周回も対象。',
'- 新規16根は既知16根から別seedで12手進めた追加進行。v0.13/v0.14進行との根局面の完全一致を除外したが、過去の全探索子孫・左右反転との非重複を保証する試験ではない。未知戦型でもない。',
'- 深さ12の歴史的な教師による評価は近似。新しい強豪エンジンに対する棋力向上は未確認。',
'- 時間区間は根単位の対応付きbootstrap 5,000回。仮想CPU・AVX2環境に依存し、多重比較補正を伴う棋力差の有意性は主張しない。',
'- 上位5候補や継続探索の機能を削除していない。今回の主比較はMultiPV=1。上位5候補を同じ予算で並行して深掘りする性能は別条件。','',
'## 起動','',
'```bash',
'make -j4',
'export YANEURAOU_ASSETS="$PWD/../opponent"',
'python3 scripts/run_v15.py fast --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000',
'```','',
'評価資材の取得、旧版の復元、全比較の再実行は [REPRODUCE-v0.15.md](REPRODUCE-v0.15.md)。生JSON・教師応答・CSV・凍結プロトコルは `results/v0.15/`、変更前ソースは `checkpoints/v0.14/`、変更差分は `CHANGES-v0.15.patch`。','']
(R/'REPORT-v0.15.md').write_text('\n'.join(lines))
intro=f'''## 探索処理の高速化と深さ配分（v0.15）

ユーザー添付のv0.14を基準に、NNUEのSIMD化・差分更新の整理・遅延した手選択を実装しました。新規16根・深さ4・各3反復では、評価値・最善手・PV・ノードを保ち、探索時間を{(1-fast['timeRatio'])*100:.1f}%短縮（{1/fast['timeRatio']:.2f}倍速）。1秒・3秒の256探索と深さ12の教師評価も保存しています。

推奨は `fast`。既存LMRと新規履歴LMRは実験設定として残しました。完了深さと選択手の品質を分けて比較し、全局対局の勝率向上はまだ主張しません。

- [結果・悪化例・採用判断](REPORT-v0.15.md)
- [文献と実装の対応](RESEARCH-v0.15.md)
- [起動・再現手順](REPRODUCE-v0.15.md)
- `results/v0.15/`：全探索・教師評価・検証・CSV・凍結プロトコル。

```bash
make -j4
export YANEURAOU_ASSETS="$PWD/../opponent"
python3 scripts/run_v15.py fast --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
# USI接続: python3 scripts/run_v15.py fast --usi
```

'''
p=R/'README.md';text=p.read_text();first,body=text.split('\n',1)
if '## 探索処理の高速化と深さ配分（v0.15）' not in text:p.write_text(first+'\n\n'+intro+body.lstrip('\n'))
print(R/'REPORT-v0.15.md')
