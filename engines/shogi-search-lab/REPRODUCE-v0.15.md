# v0.15：起動・再現手順

GCCまたはClangのC++17環境、GNU Make、Python 3、Node.jsを使う。今回の速度はAVX2対応AMD EPYC環境の測定値。非対応CPUではスカラー計算へ自動で戻るため、同じ倍率になるとは限らない。

## 通常の利用

```bash
make -j4
python3 scripts/fetch_opponent.py "$PWD/../opponent"
export YANEURAOU_ASSETS="$PWD/../opponent"

# 推奨：評価値と探索順序を保った高速化
python3 scripts/run_v15.py fast --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000

# 任意の局面。SFENは合法な4フィールドを指定
# 上のコマンドへ --sfen '...' を追加するか、
# 平手初期局面からの手順を --moves '7g7f 3c3d ...' で指定する。

# USI対応GUIへ接続
python3 scripts/run_v15.py fast --usi

# 読む範囲が変わる実験版
python3 scripts/run_v15.py lmr --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
python3 scripts/run_v15.py history --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
```

従来の `run_v14.py capture` も新バイナリを使うため、同じ高速化が適用される。基準となる旧版は別バイナリとして復元する。

`--eval nnue-scalar` でSIMDを停止し、`--eager-order` で全件ソートへ戻せる。`--eval nnue-verify` はSIMDとスカラーの各隠れ層、および差分更新と全計算を実行中に照合するため、速度測定には使わない。

## 正しさの確認

```bash
make test
python3 scripts/build_baseline_v15.py
python3 scripts/build_nnue_oracle.py
python3 scripts/verify_v15.py
python3 scripts/verify_nnue_extremes_v15.py
```

旧版は `checkpoints/v0.14/src/` に保存した変更前ファイルを作業用コピーに戻してビルドする。Git接続は不要。`verify_v15.py` は既知21根で10万ノードを固定し、旧版・新スカラー・新SIMD・照合モード・全件ソートの探索結果を比較する。さらに3根で上位5候補を照合する。上流評価器とは1,136局面の評価を照合する。

元の `results/v0.15/` は実験記録。再コンパイルするとビルドパスなどでハッシュが変わるため、その凍結記録を書き換えて同じ実験と扱わない。別の出力先で追試する。

## 保存した16局面を追試

```bash
export V15_RESULTS="$PWD/results/v0.15-repro"
mkdir -p "$V15_RESULTS"
node scripts/experiment_v15.mjs freeze
cp results/v0.15/roots.json "$V15_RESULTS/roots.json"

# 並行するビルド・学習・探索を停止し、以下を直列で実行
node scripts/experiment_v15.mjs dev
node scripts/experiment_v15.mjs fixed
node scripts/experiment_v15.mjs quality
node scripts/experiment_v15.mjs score
python3 scripts/summarize_v15.py
unset V15_RESULTS
```

- `dev`：既知8根、各20万ノード。SIMD/スカラー、ヒープ/全件ソート、既存aspiration、LMRを比較する。
- `fixed`：保存した16根、深さ4、各方式3反復、順序を回転する。
- `quality`：同じ16根、1秒・3秒、各方式2反復。すべて直列。モデル読込・プロセス起動は探索時間に含まない。
- `score`：すべての時間測定が終わってから、全方式・全反復の選択手を共通候補集合として固定教師YaneuraOu 6.03の深さ12で採点する。

開始局面の履歴は `prefix` を使って再生し、SFENだけへ置き換えない。千日手の判定に必要。各探索のPVは独立ルール実装tsshogiで合法性を確認する。

## 局面生成の追試

空の別出力先で `freeze` の後に `collect` を実行すると、固定seedでv0.14の先頭16根から12手進めた局面を作る。旧v0.13/v0.14進行との根局面の重複を検査し、終端や重複なら自動で別局面へすり替えず停止する。手順は教師深さ6・上位3候補の120cp以内から選ぶ。同じ戦型系列に属する追加進行であり、未知戦型の試験ではない。

## 記録

`results/v0.15/` に凍結プロトコル、環境、旧版プロファイル、生成手順、全探索JSON、教師応答、CSV、集計、照合結果を保存。速度区間は16根を単位に対応付きbootstrap 5,000回。反復数を局面数として扱わない。全局対局の勝率/Eloは今回測定していない。
