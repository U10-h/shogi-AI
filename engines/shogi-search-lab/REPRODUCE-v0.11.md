# v0.11 再現方法

元の v0.10 の重みを固定して、評価モデル比較と探索打切り処理を切り分けます。
既存結果を上書きせず、別の展開先で実行してください。実測のバイナリハッシュはコンパイラやビルドパスで変わり得ます。

## ビルドとモデル

```bash
make -j4
make test
python3 scripts/fetch_opponent.py ../opponent
export YANEURAOU_ASSETS="$PWD/../opponent"
export OPENBLAS_NUM_THREADS=1
python3 scripts/export_ml_model.py --base "$YANEURAOU_ASSETS/yaneuraou.data" --head models/v0.10/anchored50.npz --output build/models/v0.10/anchored50.nnue
python3 scripts/export_ml_model.py --base "$YANEURAOU_ASSETS/yaneuraou.data" --head models/v0.10/tempo40.npz --output build/models/v0.10/tempo40.nnue
```

通常USI起動：

```bash
./build/shogi-lab --usi --preset tactical --eval nnue --eval-model build/models/v0.10/anchored50.nnue
```

初回反復未完了では、読み終えた根候補があるときにその最良候補を使います。`has_result` の意味は変えず、JSONには `fallback_move`・`fallback_pv`・`fallback_source`・`fallback_partial_score` を追加。完了した探索があれば従来どおり優先。完全な根探索のスコアではないのでUSIに通常スコアとして公開しません。

## 独立した再測定

保存済み `results/v0.11` は参照用にリネームしてから空のディレクトリを作ってください。配布時の生データを破壊しないでください。

```bash
node scripts/continue_v11.mjs prepare
seq 0 3 | xargs -P4 -I{} node scripts/continue_v11.mjs collect {} 4
python3 scripts/prepare_v11.py roots
seq 0 3 | xargs -P4 -I{} node scripts/continue_v11.mjs quality {} 4
seq 0 3 | xargs -P4 -I{} node scripts/continue_v11.mjs matches {} 4
```

モデル・バイナリがプロトコルと異なる場合は停止します。これは既存プロトコルを書き換えるためのガードではありません。別ビルドを測る際は、別の実験ディレクトリで新しい `prepare` を実行します。再開時は完成JSONをスキップし、対局は局単位で再開します。中断局は最初から同じ条件で再実行します。完了結果のJSON保存には原子的なリネームを使用します。

## 旧版との探索同一性と打切り診断

`checkpoints/v0.10/src/` に保存した4ファイルを、現行の他ソースと組み合わせると旧版を復元できます。現行のソースツリー上で上書きせず、別コピーを作り、その `src/` に4ファイルを上書きして `make clean && make -j4` でビルドします。生成物を現行プロジェクトの `build/shogi-lab-v0.10` としてコピーしてください。

```bash
python3 scripts/prepare_v11.py audit
seq 0 3 | xargs -P4 -I{} node scripts/continue_v11.mjs fallback {} 4
python3 scripts/verify_v11.py usi
python3 scripts/analyze_head_v11.py
python3 scripts/parity_v11.py
python3 scripts/summarize_v11.py
python3 scripts/verify_v11.py
python3 scripts/report_v11.py
python3 scripts/plot_v11.py
```

`audit` は前回32局の全履歴から未完了だった23局面を抽出し、修正前後の探索同一性を検査します。新モデルの選択に使いません。`parity_v11.py` は後付けの仕組み診断であり、主要比較の仮説検定とは分けます。終了時に128局・79局面比較・23診断局面が揃い、全対局のノード上限が守られたことを検査します。

ノード制限なので並列化できますが、保存先はshardごとに重ならない条件にしてください。固定時間で測定する場合は、他のCPU負荷を止めて直列で行います。

## 主な出力

- `protocol.json`：モデル・バイナリの固定記録、事前条件。
- `games/`, `roots.json`, `starts.json`, `root-audit.json`：新規進行と重複除去。
- `quality/`, `quality-pending/`：3モデルの探索・教師による共通候補採点。
- `matches/`：128局、全着手と探索、KIF。
- `fallback/`, `fallback-cases.json`：過去23打切り局面の対照診断。
- `parity-control.json`：静止探索を外した固定深さ1・2・3の対照。
- `head-diagnostics.json`：旧データ上での補正分解と新規局面の整数推論検証。
- `search-invariance.json`, `usi-fallback-test.json`, `acceptance.json`：検証証跡。
- `summary.json`, `quality-comparison.csv`, `match-comparison.csv`：集計と全行比較。

Pythonの依存はNumPy（図の再作成にはMatplotlib）。対局用の独立ルール実装tsshogiは同梱済み。今回重みは学習し直していません。
