# Shogi Search Lab — 第2回：反復深化と読みの検証

C++17で探索と単純な駒得評価を自作する、将棋研究用エンジンです。
盤面更新と合法手生成は固定版YaneuraOuを使います。既存の将棋サイトとは別の実験コードです。

今回、深さを1手ずつ増やす**反復深化**、前の探索で得た**最善の読み筋（PV）の優先**、時間制御を追加しました。
詳細は [REPORT-v0.2.md](REPORT-v0.2.md)、前回の状態は `checkpoints/v0.1/` に保存しています。

## 実行

Linux、g++ 13、GNU Makeで動作確認。C++部分に追加ダウンロードは不要です。

```bash
make -j2
make test

# 深さ4を直接読む：比較基準
./build/shogi-lab --algorithm ordered --depth 4

# 深さ1、2、3、4と読み、前回の最善手を優先
./build/shogi-lab --algorithm ordered --iterative --depth 4

# 反復深化のみ：優先順序の効果を分離する比較条件
./build/shogi-lab --iterative --no-pv-order --depth 4

# 探索時間200ms、目標は最大8手先
./build/shogi-lab --iterative --depth 8 --time-ms 200
```

`depth`は双方合わせた手数です。深さ4なら先手・後手・先手・後手の4手。
評価値は根局面の手番側から見た値で、歩1枚を100点とします。

## 時間切れの出力を正しく読む

| 項目 | 意味 |
|---|---|
| `depth` | 要求した最大深さ |
| `complete` | 最大深さまで終了した、または根が終局だった |
| `has_result` | 少なくとも一つの深さを最後まで読み終えた |
| `completed_depth` | 実際に読み終えた深さ。未完了なら−1 |
| `score`, `pv`, `bestmove` | 最後に完了した深さの結果だけを返す |
| `iterations` | 完了した各深さの結果・局面数・時間 |
| `nodes`, `elapsed_ms` | 浅い探索と途中で中断した探索も含む総量 |
| `stop_reason` | `depth_limit`, `terminal`, `time_limit`, `node_limit` |

例：`depth:8, complete:false, has_result:true, completed_depth:4` は、4手先までの読みが完了し、より深い探索が途中で止まった状態です。8手読めたという意味ではありません。
`score`や`pv`に未完了の探索結果は混ぜません。
1手先も読み終わらなければ `has_result:false`, `score:null`, `bestmove:null`, `pv:[]` です。

終了コードは正常完了0、制限による中断3、不正入力2です。結果の有無は終了コードだけでなく `has_result` で判定してください。
時間は各ノードの入口で検査します。OSのスケジューリング、1ノード内の処理、ログ出力などによる超過があるため、厳密なリアルタイム保証ではありません。
局面数上限は探索全体で共通。既定200万で、`--max-nodes`で変更できます。

## 検証を再実行

```bash
make test
python3 scripts/verify_iterative.py
# 任意の独立照合：Node.js 18以上
node scripts/reference_oracle.mjs
python3 scripts/check_iterative_trace.py
# メモリ誤用・未定義動作の検査（コンパイルに時間がかかります）
bash scripts/sanitize.sh
# 最後に逐次測定。他のCPU負荷がない状態で実行
python3 scripts/benchmark_iterative.py
```

`verify_iterative.py` は8局面の深さ1～3、2方式の計48回の完了結果を全幅探索と照合します。
最善手だけでなく、読み筋の各途中局面でも全幅探索を行い、その続きを選んで根の値を達成できることを確認します。
初期局面は深さ4も全幅探索と比較します。
`reference_oracle.mjs` は別ライブラリの合法手生成と、独立した先手最大・後手最小の全幅探索で照合します。
千日手と連続王手の履歴、途中で止めた際の盤面復元、時間切れはC++テストで確認します。時間制御の検査には再現可能な模擬時計も使います。

## 自作部分

| ファイル | 役割 |
|---|---|
| `src/search.cpp` | 全幅探索、αβ、駒取り・成りの優先、反復深化、PV優先、時間制御 |
| `src/evaluate.cpp` | 盤上・持ち駒の単純合計。駒価値は前回と同じ |
| `src/board.cpp` | 既存合法手生成への接続、指す・戻す、千日手履歴 |
| `src/tests.cpp` | 自動検証 |
| `scripts/benchmark_iterative.py` | Python標準ライブラリによる実験の実行・集計 |

前のPVは、根からの手順が一致している局面でだけ指し手順序に使います。別の局面へ同じ手を流用しません。
過去の評価値や浅い探索結果で深い探索を代用しません。
YaneuraOu本来の探索とNNUE重みは使用しません。出所・変更箇所は [THIRD_PARTY.md](THIRD_PARTY.md)。

## 探索木と研究記録

```bash
./build/shogi-lab --sfen '4k4/9/P8/9/9/9/9/9/4K4 b - 1' \
  --iterative --depth 4 --trace results/my-trace.jsonl
```

記録例は `results/v0.2/iterative-trace.jsonl` です。
`iteration_start/complete/abort` が反復の境界、`enter`の`id/parent`が木の構造、`pv_priority`が前の読み筋を優先した箇所です。
`cutoff`には省いた兄弟の手と理由が残ります。ノードIDは反復をまたいで一意です。
戻り値の`exact/lower/upper`は確定値・下限・上限を表します。値の向きは各ノードの手番側です。
ログ上限による省略件数は`end.omitted_events`。省略がある木は完全ではありません。

今回の結果は `results/v0.2/`、前回のコード・結果は `checkpoints/v0.1/` にあります。
根ディレクトリの `REPORT.md` と `results/benchmark.csv` は第1回の記録です。
時間・ソースハッシュ・実験条件を残し、速度改善と正しさを別々に確認できるようにしています。

## 現時点の限界

全幅探索との一致は、その評価関数と深さにおける探索計算の確認です。将棋として強いことや、深さの先にある戦術を見落とさないことは保証しません。
今回の評価は駒の損得だけです。取り返しの途中で探索が止まる問題は残るため、静止探索は次の候補です。
入玉宣言・持将棋の裁定、置換表、静止探索、前向き枝刈り、対局時計／USI、学習済み評価は未実装です。
通常の合法手、詰み、四回同一局面、連続王手の反則を扱います。合法手は任意の不成も含む `LEGAL_ALL`。
SFENの検査は形式・枚数・玉・非手番側の王手までで、到達可能性の証明はしません。

## ライセンス

研究コードは GPL-3.0-or-later。同梱コードの表示・ライセンスは保持しています。[LICENSE](LICENSE)、[THIRD_PARTY.md](THIRD_PARTY.md) を参照してください。
