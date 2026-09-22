# v0.20 再現・利用手順

作業ディレクトリは `engines/shogi-search-lab`。GCC 13.3/C++17、GNU Make、Node.js、Python 3。実行環境の記録は `results/v0.20/environment.json`。

## 利用

```sh
make -j4
make test
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/fetch_opponent.py "$YANEURAOU_ASSETS" --check-only
node scripts/run_v20.mjs --time-ms 3000 --max-nodes 1000000000
```

ラッパーの初期設定は、計測で選んだNNUE推論方式（今回cache）と既存adaptive探索。実験用の探索変更は `--variant combo`（評価誤差補正＋cache）、`--variant continuation`、`--variant see90` 等で明示する。`--moves` には初期局面からのUSI手順を渡す。`--sfen` から途中再開だけすると千日手履歴を失う。

直接の例：

```sh
./build/shogi-lab --advanced --driver adaptive \
  --eval nnue-cache --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \
  --features tt,history,killer,counter,mate-distance,qsearch,capture-history \
  --policy-model models/v0.17/all-policy.txt --policy-mode root \
  --time-ms 3000 --max-nodes 1000000000
```

`--features` に `correction` を追加すると補正が有効。`--correction-gain 0` は値TTを無効のまま保つ対照設定。`--qsee-margin` は0〜900（歩=90）、`--eval-scale` は50〜150、`--qsee-audit` は診断専用で速度比較には使わない。NNUEの `nnue-fused` / `nnue-fast` は今回遅くなった。`nnue-fast-verify` は全計算を併用して整合性を検査する。

adaptiveには固定の候補上位数・通常の固定探索深さはない。探索努力の反復を使う。95手の緊急停止は残り、`completed_depth` は読了手数ではない。`has_result=false` の `fallback_pv` は暫定手。

## 追試

旧版は親コミット `2352b4b4913e48966f5240e92ce6da2f33f7a735` の別チェックアウトでビルドし、その実行ファイルを `build/shogi-lab-v0.19` にコピーする。今回のscreen時点から最終版への追加は補正量0を調べるオプションで、既定値の固定ノード探索は16比較で一致した。新規追試は最終版をscreen版としてもコピーすればよい。時刻やホスト負荷の影響があるため、時間制限付きのPVの完全再現は保証しない。

保存済みの結果を上書きしないよう新しい出力先を使う。

```sh
set -e
export V20_RESULTS="$PWD/results/v0.20-repro"
cp build/shogi-lab build/shogi-lab-v20-screen
node scripts/experiment_v20.mjs freeze
node scripts/experiment_v20.mjs verify
node scripts/experiment_v20.mjs speed
node scripts/experiment_v20.mjs dev
node scripts/experiment_v20.mjs score-dev
node scripts/experiment_v20.mjs select
node scripts/experiment_v20.mjs collect
node scripts/tune_v20.mjs
SPSA_RUN=-200k SPSA_NODES=200000 node scripts/tune_v20.mjs
node scripts/freeze_test_v20.mjs
node scripts/experiment_v20.mjs test
node scripts/experiment_v20.mjs score-test
cp results/v0.20/hard-roots.json "$V20_RESULTS/hard-roots.json"
node scripts/diagnostics_v20.mjs
node scripts/matches_v20.mjs
python3 scripts/summarize_v20.py
node scripts/audit_v20.mjs
```

SPSAはone-shot。途中失敗時に結果を消して都合のよい試行に置き換えず、別フォルダに試行IDと理由を残す。局面比較・教師採点・対局は保存済みの完了ブロックを飛ばして再開できる。二重起動しない。今回の時間計測はすべて直列実行、設定順を巡回し、対局は先後で設定順を逆転した。専有CPUではない。

初期protocolとtest前のamendmentにバイナリ・モデル・方策ハッシュと選択規則を記録。`run()`経由の比較はハッシュ不一致時に止まる。初回のSPSAが全反復で信号0だったので、200,000ノード試行と補正量0対照を未使用局面の測定前に追加した。候補の選択は開発局面だけで行った。

教師はYaneuraOu 6.03 WASM（1 thread、32MB、定跡なし）。全設定・両時間の着手と教師の推奨手を共通候補にし、深さ12でMultiPV再評価。教師cpは自作の歩=90単位と直接比較しない。詰み評価を含む局面はcp平均から除外し、除外数を明記。今回のtest局面はseed 20301〜20306の6進行の20/36/52/68手後。進行内で相関があるので、補助的な95%区間は進行単位のbootstrap 20,000回。NNUEや既存方策の学習集合との完全非重複は確認できない。

生データは `results/v0.20/raw-results.tar.gz` にまとめている。`results/v0.20/manifest.json` のSHA-256と一覧で確認し、この作業ディレクトリから `tar -xzf results/v0.20/raw-results.tar.gz` で展開する。JSONには初期からの全手順、PV、停止理由、ノード数、統計、教師応答を保存し、USIログとKIFも含む。
