# v0.16 再現手順

GCC/Clang C++17、Python 3 + NumPy、Node.js。評価資材は過去と同じ固定版。

```bash
make -j4
# Webアプリのリポジトリに同梱した資材を使う場合
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/fetch_opponent.py "$YANEURAOU_ASSETS" --check-only

# 深さ・候補数を指定しない。時間を使い切るまで読む費用の閾値を広げる
python3 scripts/run_v16.py adaptive --time-ms 3000
python3 scripts/run_v16.py blend --time-ms 3000
python3 scripts/run_v16.py clipped --time-ms 3000
python3 scripts/run_v16.py tempo --time-ms 3000
# 従来設定との比較
python3 scripts/run_v16.py baseline --time-ms 3000
python3 scripts/run_v16.py history --time-ms 3000
# 任意の開始手順は --moves '7g7f 3c3d ...' を追加
# GUI用（adaptive の深さ指定は使わず go movetime を使用）
python3 scripts/run_v16.py adaptive --usi
make test
```

`adaptive` は `--depth` / `--qdepth` を探索目標として使わない。時間、ノード数、外部停止で止める。安全のため95plyの再帰上限を残し、到達すると未完了として中止する。静止探索は王手回避・駒取り・成りを扱い、非王手の静かな手を列挙する全幅探索ではない。時間内に未完了となった反復は前の完了結果を保持し、最初の反復も終わらないときは合法な緊急手を別フィールドに出す。

`completed_depth` は互換性のため残すが、adaptive では実手数ではなく4費用単位ずつの反復番号。JSONの `iteration_unit=effort_steps_4` で区別する。実際に訪問した最大手数は `stats.selective_depth`、採用した読み筋の手数は `pv.length`。`qreturn_ply_*` は静止探索の戻り節点分布（葉だけの分布ではない）。`root_nodes_*` は完了した根の子探索に費やしたノードで、中断された子の作業は含まれない。

MultiPV 5を使う従来機能は保持。新adaptiveドライバの今回の検証範囲はMultiPV 1。候補数を1手に限定して探索する意味ではなく、全合法手を候補に持ち、αβカットに従って探索する。

## 固定した16根を追試

元の `results/v0.16/` を書き換えず、出力先を分ける。すべての時間試験は直列に実行する。再コンパイル後はバイナリハッシュが変わる場合があるため、新しい凍結プロトコルを作る。

```bash
export V16_RESULTS="$PWD/results/v0.16-repro"
node scripts/experiment_v16.mjs freeze
cp results/v0.16/roots.json "$V16_RESULTS/roots.json"
node scripts/experiment_v16.mjs quality
node scripts/experiment_v16.mjs score
node scripts/experiment_v16.mjs matches
python3 scripts/summarize_v16.py
```

局面生成から再現する場合はrootsのコピーの代わりに `node scripts/experiment_v16.mjs collect`。教師の深さ6・上位3候補の120cp以内から固定乱数種で8手進める。終端・既知の根との重複が発生した場合はエラーとして残し、別局面への自動差し替えはしない。

教師採点は、全6設定・全時間・反復の選択手と教師自身の手を共通集合にし、深さ12のMultiPVで行う。通常cp以外の候補を含む根はcp平均から除外し、件数を報告する。手数上限200の対局は引分にせず未決着とする。棋譜は初期局面からの全履歴を含むJSON/KIF。

## 評価の再検証と旧バイナリ

`models/v0.16/pair100-head.txt` はv0.12 pair100の後段だけのテキスト出力。追加学習は行っていない。第一隠れ層までを共有し、元評価と学習済み後段の両方を計算する。元のNPZと整数推論の対応は `scripts/verify_v16.py`。

照合時の `build/shogi-lab-v0.15` は、変更前のv0.15をビルドして退避したもの。再構築するには、別作業ディレクトリへソースをコピーし、`checkpoints/v0.15/src/` のファイルを `src/` に戻して `make clean && make -j4`。その生成物を `build/shogi-lab-v0.15` に置いてから `python3 scripts/verify_v16.py`。元の実験フォルダに検証結果を書き直したくない場合は作業コピーで実施する。
