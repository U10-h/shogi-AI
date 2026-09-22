# v0.17 再現手順

GCC C++17、Node.js、Python 3 + NumPy/SciPy。元NNUEと教師のWASM資材はこれまでの固定版を使用する。

```sh
make -j4
make test
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/fetch_opponent.py "$YANEURAOU_ASSETS" --check-only

# 平手から、学習した最初の手の順序＋選択的探索。探索深さ・候補数は指定しない。
./build/shogi-lab --advanced --driver adaptive \
  --eval nnue --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \
  --features tt,history,killer,counter,mate-distance,qsearch,capture-history \
  --policy-model models/v0.17/all-policy.txt --policy-mode root \
  --time-ms 5000 --max-nodes 1000000000

# 同じ設定のまま、指定手順から続ける場合にだけ --moves を追加する。
# GUIでは上記に --usi を追加し、go movetime 5000 を送る。
```

`--policy-mode`は `quiet`（v0.14互換の静かな手の加算）、`root`（最初の手だけ）、`all`（全節点）、`cost`（学習した辺費用＋中間再探索）。非quiet方式にはモデルが必要。実験ではscale=1を使った。`cost`はadaptive専用。全節点への適用は今回悪化例があり、学習方式名だけで推奨を決めない。

`--root-scheduler off|roundrobin|puct|halving|reliability` はadaptive専用。標準はoff。小分け探索は中断位置のスタックから再開するものではなく、完了済みのTT・履歴を使って同じ根候補を再探索する。原著のMCTSや整数計画ソルバーではない。

固定の深さ制限ではなく、静止探索は王手回避・駒取り・成りを継続する。95plyの非常停止は残す。`completed_depth`はadaptiveでは費用反復を示す。実際の読み筋は `pv`、どこかの枝の最大到達は `stats.selective_depth`。完了しなかった場合は `fallback_pv` と `fallback_source` を使い、完了結果と区別する。

## データと計測

元の結果を書き換えないため、以下はリポジトリの作業コピーで実施し、そのコピーの `results/v0.17` と `models/v0.17` を別の場所へ退避してから再生成する。既存JSONを上書きするため、保存済みの原データを直接消さない。

```sh
node scripts/selfplay_v17.mjs
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/train_policy_v17.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/ablate_selfplay_v17.py
node scripts/experiment_v17.mjs freeze
node scripts/experiment_v17.mjs dev
node scripts/experiment_v17.mjs score-dev
python3 scripts/select_v17.py
node scripts/experiment_v17.mjs fallback
node scripts/experiment_v17.mjs test
node scripts/experiment_v17.mjs score-test
node scripts/long_fallback_v17.mjs

# 0..3は対局分担番号。順番に実行しても16局を再現できる。
node scripts/matches_v17.mjs 0
node scripts/matches_v17.mjs 1
node scripts/matches_v17.mjs 2
node scripts/matches_v17.mjs 3
python3 scripts/summarize_v17.py
node scripts/audit_v17.mjs
```

計測時は8CPU相当の割当、9仮想コアの環境で、4対局を仮想コア0–3に固定し、局面比較を別のコア7で直列実行した。全体でCPU割当を超えないようにした。対局方式・時間・先後・開始局面が特定の1コアだけに偏らないよう割り当てた。CPU・実測時間は `environment.json` と各棋譜の `worker`、`cpuAffinity`、`wallMs` に残す。

時間指定の探索は実行環境やOSのスケジューリングで到達するノードが変わる。完全に同じ手順になる保証はない。元の棋譜、全応答、モデル・バイナリのSHA-256、固定した局面と比較手集合を残している。モデルとバイナリが凍結プロトコルに一致しなければ実験を開始しない。

## v0.16との固定ノード照合

`scripts/verify_v17.mjs` は `SHOGI_V16_BIN` または `build/shogi-lab-v0.16` を参照する。旧バイナリを再構築するには、別の作業コピーで `checkpoints/v0.16/src/` の4ファイルを `src/` へ戻してビルドする。これは今回変更した4ファイルの変更前スナップショットで、ほかのソースはv0.16と同じ。

```sh
export SHOGI_V16_BIN=/absolute/path/to/v0.16/build/shogi-lab
node scripts/verify_v17.mjs
```

この照合は新しい分配方式の棋力保証ではない。既存設定の固定ノード結果を維持し、学習による手順序だけの変更で完了した全幅minimaxの値が変わらないことを確かめる。
