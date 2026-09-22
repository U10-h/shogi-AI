#!/usr/bin/env python3
"""Insert measured v0.8 results into the report and front page."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1];d=root/'results/v0.8'
s=json.loads((d/'summary.json').read_text());m=json.loads((d/'matches.json').read_text())
def record(a):return f"{a['wins']}勝{a['losses']}敗・引分{a['draws']}・未決着{a['unresolved']}"
self_result=record(s['matches']['positional']);yane_result=record(s['matches']['yaneuraou'])
move_count=sum(len(g['moves']) for g in m['games']);pv_count=sum(len(r['analysis'].get('pv',[])) for g in m['games'] for r in g['moves'])
completed=sum(r['complete'] for r in json.loads((d/'verification.json').read_text())['searchRows'])
pairs=s['qualityPairs'];speed=s['speed'];red=s['speedReductionPercent'];q=s['quality']
result=f'''## 検証結果

改善版は手動位置評価版との小規模な実対局で **{self_result}** でした。固定版やねうら王には **{yane_result}** です。NNUEは追加の推奨評価モードとし、過去実験用の既定値は維持します。

| 確認事項 | 結果 |
|---|---|
| 本家ソースの静的評価との照合 | 2,246入力 × 3実装モードで完全一致。最大誤差0 |
| accumulatorの全再計算との照合 | 検証モードで243,773回、一致 |
| 探索結果の対照比較 | 30条件で評価値・最善手・PV・ノード数・停止理由が一致。深さ完了{completed}条件、ノード上限による停止{30-completed}条件 |
| 旧v0.7の駒得／手動評価との比較 | 20条件で評価値・最善手・PV・ノード数が一致 |
| 既存回帰テスト | 1,893項目通過 |
| 追加の入出力検証 | 不正モデル5件を拒否。USIのcp変換・評価切替・時間中断・stop後の再探索を確認 |
| 実対局と棋譜 | 全6局、{move_count}着手と採用PV内の{pv_count}手を別のルール実装で検証。6棋譜のKIF往復で手順一致 |

### 速度：探索結果を同一に保った対照比較

| 評価 | 計算法 | 評価を呼ぶ条件 | 平均探索時間（ms） |
|---|---|---|---:|
| NNUE | 全再計算 | 常時 | {speed['nnue-full-eager']['meanMs']:.2f} |
| NNUE | 全再計算 | 必要時 | {speed['nnue-full-lazy']['meanMs']:.2f} |
| NNUE | 差分計算＋静的評価再利用 | 常時 | {speed['nnue-eager']['meanMs']:.2f} |
| NNUE | 差分計算＋静的評価再利用 | 必要時 | {speed['nnue-lazy']['meanMs']:.2f} |
| 手動位置評価 | 従来の評価処理 | 常時 | {speed['positional-eager']['meanMs']:.2f} |
| 手動位置評価 | 従来の評価処理 | 必要時 | {speed['positional-lazy']['meanMs']:.2f} |

NNUEの全再計算・常時評価に対して、差分計算・必要時評価は **{red:.1f}%短縮（約{speed['nnue-full-eager']['totalMs']/speed['nnue-lazy']['totalMs']:.2f}倍の処理速度）**でした。NNUEの4条件はいずれも合計ノード数128,043で同一です。これはNNUEの実装方法の比較であり、v0.7から棋力が同じ割合で上がったという意味ではありません。手動評価とNNUEでは探索する木が異なります。差分計算を使う場合、必要時評価だけの追加短縮は小さく、独立した確実な改善幅として一般化しません。

### 着手：新規12局面、双方3秒

| 評価モード | 教師が評価した候補集合内の最良値との差（平均cp） | 平均完了深さ |
|---|---:|---:|
| 手動位置評価 | {q['positional']['meanCandidateGapCp']:.2f} | {q['positional']['meanCompletedDepth']:.2f} |
| NNUE | {q['nnue']['meanCandidateGapCp']:.2f} | {q['nnue']['meanCompletedDepth']:.2f} |

改善{pairs['better']}局面、同等{pairs['equal']}局面、悪化{pairs['worse']}局面でした。平均深さは増えていません。評価の差が、より浅い探索でも良い手を選ぶことにつながった例です。**差0は候補集合内の教師判断であり、全合法手に対する完全な最善手や無失策を意味しません。教師と改善版の重みは共通です。**

### 実対局の内訳

| 対戦相手 | 改善版の先後 | 実戦部分の手数 | 結果 | 終了理由 |
|---|---|---:|---|---|
'''
for g in m['games']:
 r=g['result'];outcome='未決着' if r.get('unresolved') else '引分' if r['winner'] is None else '勝ち' if r['winner']==g['candidateSide'] else '負け'
 result+=f"| {'手動位置評価' if g['opponent']=='positional' else '固定やねうら王'} | {'先手' if g['candidateSide']=='black' else '後手'} | {len(g['moves'])} | {outcome} | {r['reason']} |\n"
result+='\n少数局・限定した開始局面の結果なので、勝率やEloを推定しません。対やねうら王の旧実験とは開始手順も異なり、直接の棋力差の推定には使いません。評価の改善は支持されましたが、本家と同等の探索性能に到達したとは判断していません。\n\n'
p=root/'REPORT-v0.8.md';text=p.read_text();start='<!-- V08_RESULTS_START -->\n';end='<!-- V08_RESULTS_END -->\n'
if start in text:
 a=text.index(start);b=text.index(end,a)+len(end);text=text[:a]+text[b:]
first,rest=text.split('\n',1);p.write_text(first+'\n\n'+start+result+end+rest.lstrip('\n'))
p=root/'README.md';text=p.read_text();first,rest=text.split('\n',1)
start='<!-- V08_START -->\n';end='<!-- V08_END -->\n'
if start in rest:
 a=rest.index(start);b=rest.index(end,a)+len(end);rest=rest[:a]+rest[b:]
intro=f'''## やねうら王とのコード比較とNNUE導入（v0.8）

固定対戦版6.03のK+P型NNUEを自作探索に組み込み、差分計算と不要な評価の省略を追加しました。重みは既存の配布物を利用しています。本家ソースと2,246局面で評価値が一致し、同じ探索結果のままNNUE全再計算版より処理時間を{red:.1f}%短縮しました。

手動位置評価版には{self_result}（双方300ms）、固定やねうら王には{yane_result}（双方3000ms）。小規模な検証であり、Eloや一般的な勝率の推定ではありません。

- [コードの差・改善判断・全検証結果・再現方法](REPORT-v0.8.md)
- `results/v0.8/`：条件、未加工の結果、全6局の棋譜。
- `checkpoints/v0.7/`：変更前のソース。`scripts/build_checkpoint.py v0.7` で再ビルド可能。

```bash
make -j2
python scripts/fetch_opponent.py "$PWD/../opponent"
export YANEURAOU_ASSETS="$PWD/../opponent"
./build/shogi-lab --advanced --preset tactical --eval nnue \\
  --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \\
  --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
```

推奨は `--eval nnue`。NNUE重みは外部取得です。過去実験との互換性のため既定値materialは維持し、手動位置評価は `--eval positional` で使用できます。

'''
p.write_text(first+'\n\n'+start+intro+end+rest.lstrip('\n'))
(d/'match-verification-counts.json').write_text(json.dumps({'games':len(m['games']),'moves':move_count,'selectedPvMoves':pv_count,'kifRoundtrips':len(m['games']),'method':'Assertions in match_nnue.mjs; independent tsshogi legality and KIF USI-move roundtrip'},indent=2))
print(json.dumps({'report':str(root/'REPORT-v0.8.md'),'moves':move_count,'pvMoves':pv_count,'self':self_result,'yaneura':yane_result},ensure_ascii=False))
