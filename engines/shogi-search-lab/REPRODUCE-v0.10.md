# v0.10 再現方法

## 学習済み候補を動かす

Linux、g++13、Python3、NumPy2.3.5、Node24.19.0で実行しました。図の再作成のみMatplotlib3.10.8が必要です。C++の通常ビルドにPythonの機械学習依存は不要です。

```bash
make -j2
python3 scripts/fetch_opponent.py "$PWD/../opponent"
export YANEURAOU_ASSETS="$PWD/../opponent"
export OPENBLAS_NUM_THREADS=2
python3 scripts/export_ml_model.py \
  --base "$YANEURAOU_ASSETS/yaneuraou.data" \
  --head models/v0.10/anchored50.npz \
  --output build/models/v0.10/anchored50.nnue
./build/shogi-lab --advanced --preset tactical --eval nnue \
  --eval-model build/models/v0.10/anchored50.nnue \
  --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
```

対局GUIでは同じ評価設定を付けて `--usi` で起動できます。起動した探索の既定値は変更していないため、候補を使う際は明示的な `--eval-model` が必要です。

## 生データから再学習する

配布物にはデータ・選択済みヘッド・測定結果が入っています。保存済み結果を上書きせず独立したコピーで実行してください。測定スクリプトは完了済み結果をスキップします。再測定にはそのコピーの該当出力ディレクトリを別名で退避し、元の生データを残してください。

```bash
python3 scripts/prepare_ml_data.py
python3 scripts/train_ml.py --stage naive
seq 0 3 | xargs -P4 -I{} node scripts/evaluate_ml.mjs naive {} 4
python3 scripts/train_ml.py --stage rebuild
seq 0 3 | xargs -P4 -I{} node scripts/evaluate_ml.mjs rebuild {} 4
python3 scripts/make_ml_control.py
seq 0 3 | xargs -P4 -I{} node scripts/evaluate_ml.mjs biascontrol {} 4
python3 scripts/freeze_ml_model.py
python3 scripts/verify_ml_models.py naive anchored25 anchored50
python3 scripts/static_test_ml.py
node scripts/evaluate_ml.mjs test 0 1
seq 0 3 | xargs -P4 -I{} node scripts/match_ml.mjs {} 4
python3 scripts/summarize_ml.py
python3 scripts/plot_ml.py
python3 scripts/report_ml.py
```

調整用候補が事前に実装済みなので、これは記録した再構築の再現です。独立した新実験にする場合は新しい未観測の最終評価集合が必要です。測定用バイナリを作り直した場合、コンパイラやパスによりバイナリハッシュが変わり、既存の凍結記録と一致しないことがあります。その場合も既存記録を書き換えず、別の実験記録として扱ってください。

生データ自体を再生成する場合は、コピー内の `results/v0.10/games` と `games-final` を退避したうえで、下記を前段に実行します。完成データの正本は `games-final` です。

```bash
seq 0 3 | xargs -P4 -I{} node scripts/collect_ml.mjs {} 4
```

## 比較条件と検証

- 学習・固定ノード実験は並列化可能です。時間制限による探索比較は必ず直列にし、学習や対局などCPUを使う他の実験を同時実行しません。
- 最終比較はモデルの実行順を局面ごとに交替。1秒96局面、3秒24局面は一部共通なので、120個の独立局面とは数えません。
- 対局は16開始局面×先後交換、各手12,000ノード、開始局面から最大200手。打切り未決着を引分扱いしません。
- 初回反復を完了できない場合、両者とも既存USI互換の最初の合法手を使い、代替着手数と元の探索出力を保存します。
- 教師の候補採点は両者の選択手と教師の手をまとめ、深さ10で同一候補集合を比較。全合法手を採点するため最終評価では `GenerateAllLegalMoves=true` を指定します。
- 検証時に教師が不成候補を除外する問題を発見しました。既測定の29件の探索結果を保持して全件再採点、失敗した1件は最初の診断再実行結果を使用。詳細は `measurement-amendment.json`。学習モデルの再調整はありません。
- 乱数種は固定ですが、時間制限・浮動小数点BLAS・教師の探索による差はあり得ます。SHA-256は同梱した実測物を識別する値です。

基礎回帰検証は `make test`。NNUEの独立特徴抽出・Python/C++整数推論一致・全再計算/差分探索一致は、データ準備と `verify_ml_models.py` で確認します。

## 主な成果物

| パス | 内容 |
|---|---|
| `models/v0.10/` | 学習済みヘッド、浮動小数点チェックポイント、モデルカード |
| `results/v0.10/protocol.json` | データ生成前の実験条件 |
| `results/v0.10/games-final/` | 教師の全192進行と上位候補・読み筋 |
| `results/v0.10/labels.jsonl`, `dataset.npz` | 分割・由来付きラベル、特徴、教師値 |
| `results/v0.10/training-*.json` | 学習曲線、検証値、選択エポック |
| `results/v0.10/*decision.json`, `frozen-model.json` | 再構築・対照実験・選択の記録 |
| `results/v0.10/quality-*/` | 各モデルの探索と教師採点の生出力 |
| `results/v0.10/matches/` | 最終32局の各着手・探索出力・KIF |
| `results/v0.10/summary.json`, `test-comparison.csv` | 集計、対局単位のブートストラップ区間、全比較 |

`quality-test-pre-repair` は修正前の参考記録、`quality-test-pending` は教師採点前の探索出力です。最終集計は `quality-test` だけを使用します。
