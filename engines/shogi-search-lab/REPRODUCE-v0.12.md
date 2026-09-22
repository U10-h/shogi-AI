# v0.12 再現手順

既存の`results/v0.12/`は測定証拠です。再実行時は別の展開先で退避し、空の同名ディレクトリを作ってください。結果や事前プロトコルを上書きするためにガードを外さないでください。

## ビルド・準備

```bash
make -j4
make test
python3 scripts/fetch_opponent.py ../opponent
export YANEURAOU_ASSETS="$PWD/../opponent"
export OPENBLAS_NUM_THREADS=1
python3 scripts/export_ml_model.py --base "$YANEURAOU_ASSETS/yaneuraou.data" --head models/v0.10/anchored50.npz --output build/models/v0.10/anchored50.nnue
python3 scripts/export_ml_model.py --base "$YANEURAOU_ASSETS/yaneuraou.data" --head models/v0.10/tempo40.npz --output build/models/v0.10/tempo40.nnue
```

PythonはNumPy、図の作成にはMatplotlibを使います。C++17、Node.jsが必要です。教師のWASM・評価はハッシュを固定し、別の版で代用しません。元のv0.10のデータ・分割をそのまま使用します。

## 学習と対照

```bash
mkdir -p results/v0.12
python3 scripts/train_pairs_v12.py > results/v0.12/train.log
python3 scripts/train_rank_v12.py > results/v0.12/train-rank.log
```

候補差モデルは検証集合で選択し、出力の平均調整は学習集合だけで行います。順位試行の現行スクリプトは、整数化後の分布の標準偏差比が[0.9,1.1]を外れるなどの異常を検出すると停止します。今回の確認では10エポック目で停止し、選択されたモデルは元評価のままでした。学習率や損失をテスト結果に合わせて変更していません。

初期の60エポック試行の数値不安定化を再現する場合は、空の実験先で代わりに次を実行します。失敗の診断用であり、運用用モデルを作る手順ではありません。

```bash
PYTHONPATH=scripts python3 checkpoints/v0.12/train_rank_projection_initial.py
```

今回保存した`rank-training.json`と`train-rank.log`は初期試行、`rank-safety-check.json`は停止処理を別作業先で確認した記録です。両者とも選択は元評価であり、対局に投入していません。主比較の候補差学習は`pair100.npz`、倍率対照は`affine-gap.npz`です。

学習を省略して既存の固定済み重みを再測定する場合：

```bash
python3 scripts/export_ml_model.py --base "$YANEURAOU_ASSETS/yaneuraou.data" --head models/v0.12/pair100.npz --output build/models/v0.12/pair100.nnue
python3 scripts/export_ml_model.py --base "$YANEURAOU_ASSETS/yaneuraou.data" --head models/v0.12/affine-gap.npz --output build/models/v0.12/affine-gap.nnue
```

この場合、`selected.json`を含む学習記録を複製した上で、プロトコル・収集・比較の出力が存在しない新しい実験先を使います。

## 新規進行・局面・対局

```bash
node scripts/continue_v12.mjs prepare
seq 0 3 | xargs -P4 -I{} node scripts/continue_v12.mjs collect {} 4
python3 scripts/prepare_v12.py
seq 0 3 | xargs -P4 -I{} node scripts/continue_v12.mjs quality {} 4
seq 0 3 | xargs -P4 -I{} node scripts/continue_v12.mjs matches {} 4
seq 0 3 | xargs -P4 -I{} node scripts/continue_v12.mjs trace {} 4
```

ノード制限なので並列実行できます。固定時間の測定にはこの並列条件を流用しないでください。出力JSONの完成後はスキップし、未完了の対局は同じ開始局面から再実行します。局面比較は探索結果を中間保存します。

配布結果では、最初に候補差学習を固定して進行を生成し、その間に旧検証集合での倍率対照・順位試行を追加しました。新規モデル比較を開く前の改訂は`protocol-v1.json`と`protocol.json`の`amendment`に記録しています。現在の`prepare`は最終的に比較した5モデル・2ノード条件・対局ペアを最初から設定するので、新しい再測定では`amend`は不要です。

対局は8開始×先後交換×2モデル組×2予算＝64局です。根は、教師深さ6で概ね均衡した未出局面を24進行から選ぶ規則を固定し、今回22局面が採用されました。両予算で同じ22局面・同じ教師候補集合を使います。

## 分析と検証

```bash
node scripts/test_pairs_v12.mjs
python3 scripts/static_pairs_v12.py
python3 scripts/analyze_v12.py leaves
node scripts/verify_leaf_edges_v12.mjs
python3 scripts/analyze_v12.py
python3 scripts/verify_v12.py
python3 scripts/report_v12.py
```

`verify_v12.py`の旧版照合には`build/shogi-lab-v0.11`が必要です。別コピーのソースに`checkpoints/v0.11/src/`の3ファイルを戻し、`make clean`後にビルドして、そのバイナリだけを現行の`build/shogi-lab-v0.11`へコピーします。現行ソースを旧版で上書きしないでください。

`verify_v12.py`は、結果を見た後の最大悪化例について、固定深さ2/3とノード制限を変えた診断も行います。この診断を未観測データによる独立試験として集計しないでください。

## 葉の記録を単独で使う

```bash
./build/shogi-lab --advanced --preset tactical --eval nnue --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" --moves "7g7f 3c3d" --depth 16 --iterative --max-nodes 12000 --leaf-trace leaves.jsonl --trace-limit 100000
```

ノード上限による終了コード3は正常な打切りです。`qeval`は静止探索内の評価・王手回避記録、`qreturn`は完了した戻り値です。王手中の静的スコアはnull。通常探索から入った静止探索の`parent_qnode`は0で、通常探索全体の親子記録ではありません。中断中の節点は戻り記録を持ちません。トレース上限を超えた件数は`stats.leaf_trace_omitted`です。

## 主な結果

- `training*.json`、`rank-*.json`：学習条件、選択、失敗と停止処理。
- `games/`、`roots.json`、`root-audit.json`：24進行、22採用根、選択規則。
- `static-test*.json/npz`：新規3,676兄弟ペアの静的指標。
- `quality/`：22根×5モデル×2予算＝220探索と共通候補教師評価。
- `matches/`：64局の全着手・PV・KIF。
- `traces/`：32探索の全静止探索評価・戻りイベントとON/OFF一致記録。
- `leaf-summary.json`、`base-leaf-features.npz`：同じ葉で比較した補正・固定窓感度。
- `depth-diagnosis.json`：1,490cp悪化例の完了深さ診断。
- `summary.json`、CSV、`overview.png`：全比較の集計と図。
- `acceptance.json`：個数、ハッシュ、結果整合性の最終確認。

レポートは`REPORT-v0.12.md`。今回のモデルは標準評価へ昇格していません。
