# v0.18 再現手順

GCC C++17、GNU Make、Python 3、Node.js。評価資材と独立ルール実装は従来の固定版を使う。

```sh
make -B -j4
make test
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/fetch_opponent.py "$YANEURAOU_ASSETS" --check-only

# v0.17の学習済み根方策＋選択的探索（比較基準）
./build/shogi-lab --advanced --driver adaptive \
  --eval nnue --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \
  --features tt,history,killer,counter,mate-distance,qsearch,capture-history \
  --policy-model models/v0.17/all-policy.txt --policy-mode root \
  --time-ms 5000 --max-nodes 1000000000
```

`--features` に `qcache`（読みの再利用）、`qguard`（保護条件付きSEE）、または両方を追加すると実験方式になる。固定の探索深さ・候補数は指定しない。読み筋は `pv`、最大到達は `stats.selective_depth`、`completed_depth` は費用反復数であり手数ではない。初回未完了の場合は `fallback_pv` を使い、完了した比較とは区別する。

## 旧版の復元

別の作業コピーに、`checkpoints/v0.17/Makefile` と同フォルダの `src/` の4ファイルを戻し、`make -B -j4` でビルドする。ほかのコード・モデルは共通。得た旧バイナリを `build/shogi-lab-v0.17` に置くか `SHOGI_V17_BIN` を絶対パスで設定する。既存バイナリを上書きして計測を続けない。

## 新しい出力先での追試

保存済み `results/v0.18` を上書きしない。次のように別名を指定する。freeze以降、バイナリやモデルを変更すると実験は拒否される。シェルはエラーで止める。

```sh
set -e
export V18_RESULTS="$PWD/results/v0.18-repro"
node scripts/experiment_v18.mjs freeze
node scripts/verify_v18.mjs
node scripts/overhead_v18.mjs
node scripts/experiment_v18.mjs dev
node scripts/experiment_v18.mjs score-dev
node scripts/experiment_v18.mjs select
node scripts/experiment_v18.mjs collect
node scripts/experiment_v18.mjs diagnose
node scripts/experiment_v18.mjs test
node scripts/experiment_v18.mjs score-test
node scripts/matches_v18.mjs 0
node scripts/matches_v18.mjs 1
node scripts/matches_v18.mjs 2
node scripts/matches_v18.mjs 3
python3 scripts/summarize_v18.py
node scripts/audit_v18.mjs
node scripts/viewer_v18.mjs
```

上記は直列実行例。今回の計測はCPU割当8コア相当で対局4組をコア0–3、局面比較をコア7、補助検証をコア6へ固定した。各対局組は同じ先後・時間の2方式を同一コアで順に実行し、開始順を入れ替えた。500msの開発比較はCPU固定なし・余剰CPU上のセルフテストと一部重複した探索的測定である。

`collect`は4つの教師進行を64手ずつ生成する。最初の20手は深さ8・上位3候補の100cp以内から固定乱数で選ぶ。最後まで指した対局ではなく、局面サンプリング用の進行である。保存した手順により、生成の再実行に依存せず試験を追試できる。

`diagnose`は既知の終盤6局面の1秒比較と、その先頭3局面の反実仮想監査。監査の10万ノードには確認探索を含む。`--qguard-audit`は棋力評価・速度計測用ではない。棋譜・PVはtsshogi、終局は両ルール実装で確認する。

時間制限ではOSやCPUの影響で手順が変わる。今回の固定プロトコル、モデル・バイナリのハッシュ、全探索出力、教師応答、棋譜、失敗した監査起動ログも保存する。v0.17ブランチに存在しなかった旧実験原データを復元したとは扱わない。

## 実行環境の再接続

今回、実行環境が途中で再起動した。局面比較の未保存ブロックだけ再実行し、3局は42手・62手・39手から再開した。`matches_v18.mjs` は保存済みの着手を再生してから続け、毎手の探索状態は元からリセットされる。再接続の位置・時刻は棋譜JSONの `resumptions`、全体記録は `runner-recovery.json` にある。同じプロセスがまだ動いている場合は、二重起動しない。
