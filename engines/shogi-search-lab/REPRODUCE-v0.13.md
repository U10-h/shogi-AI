# v0.13 再現手順

保存した `results/v0.13/` は実測証拠。再実行は別の展開先で同ディレクトリを退避してから行う。固定プロトコルのハッシュ検査を無効にせず、新しいビルド用には新しい `prepare` を実行する。

## ビルドと1局面の探索

```bash
make -j4
make test
python3 scripts/fetch_opponent.py ../opponent
export YANEURAOU_ASSETS="$PWD/../opponent"
export OPENBLAS_NUM_THREADS=1
./build/shogi-lab --advanced --preset tactical --eval nnue \
  --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \
  --depth 16 --iterative --max-nodes 12000 \
  --prune-policy efficient --prune-model models/v0.13/alpha-risk-cost.txt \
  --prune-probability 0.0025
```

Python 3・NumPy、図にMatplotlib、C++17、Node.jsを使用。WASM教師と評価ファイルは固定版を取得し、ハッシュ不一致なら中止する。省略オプションを外せば基準版となる。モデルは実験用で標準採用していない。

## 学習・校正・開発評価

```bash
mkdir -p results/v0.13
python3 scripts/prune_v13.py prepare
python3 scripts/prune_v13.py collect
python3 scripts/prune_v13.py train
python3 scripts/prune_v13.py development
python3 scripts/train_prune_cost_v13.py
python3 scripts/prune_v13.py improve
python3 scripts/audit_prune_data_v13.py
```

`collect` と開発評価は4並列で、固定ノード数または固定深さを使う。`collect` はログON/OFFの結果一致を12根ごとに確認する。ログが末尾まで読めない場合は学習を中止する。初回収集で5ログに末尾欠損を検出したため、明示flush・書込例外検知を追加し、5件を再収集した。配布した `.jsonl` は全行を検査済みである。

現在の `development` は `staticcheck` という明示名を使う。初期コードでは静的確認を `verified` と呼んだ。初期結果 `development/` と `development-initial-summary.json` の `verified` は静的確認であり、現行の深さ1確認は `development-improved/` の `verified`。変更前の探索は `checkpoints/v0.13-initial-advanced.cpp` に保存している。

開発選択は `development-selection.json` に固定した。安全性を重視し、32根の根着手・スコアが全一致、監査の見落とし0件だった `efficient0025` を対局候補にした。再現用には保存した同ファイルを複製する。別の候補を選び直す実験は、新しい版番号とテスト進行を使う。

## 固定後の新規評価

```bash
node scripts/continue_v13.mjs prepare
seq 0 3 | xargs -P4 -I{} node scripts/continue_v13.mjs collect {} 4
python3 scripts/prepare_v13.py
seq 0 1 | xargs -P2 -I{} node scripts/continue_v13.mjs quality {} 2
seq 0 1 | xargs -P2 -I{} node scripts/continue_v13.mjs audit {} 2
seq 0 1 | xargs -P2 -I{} node scripts/continue_v13.mjs matches {} 2
```

上記の全処理が終了してから、他の重い処理なしで実時間測定を実行する。

```bash
node scripts/continue_v13.mjs fixed
python3 scripts/diagnose_prune_v13.py
python3 scripts/analyze_prune_v13.py
python3 scripts/report_prune_v13.py
```

24新規根×8方式×2予算=384探索。教師深さ10で、両予算・全方式が選んだ手と教師の最善手を同じ候補集合として再評価する。単独教師探索の値と候補制限探索の値を混ぜない。深さ3は24根×8方式×3反復=576探索、方式の順序を回転させる。実時間は探索内部の経過時間で、プロセス起動・モデルロードを含めない。監査は最初の16根×6方式=96探索。対局は同じ8開始局面を先後交換し、候補対基準・候補対deltaの計32局。

根の採用は教師評価だけで行い、全方式の結果を開く前に固定する。新規探索の全ての子孫が未知局面という意味ではない。詰みスコアをcpに擬似変換せず、未決着の対局を引分にしない。

## 実装検証・保存

```bash
python3 scripts/build_reference_v13.py
cp build/shogi-lab-v0.12-rebuilt build/shogi-lab-v0.12
python3 scripts/verify_prune_v13.py
python3 scripts/package.py
```

検証スクリプトは旧版との19探索一致、閾値0の19探索一致、独立に再構成した587行の特徴、全窓子探索19件のラベル符号、無効設定の拒否を確認する。監査付き・なしの根結果とノード差の照合は集計スクリプトに含む。`MANIFEST.json` に全梱包ファイルのSHA-256を記録し、ソース・重み・データ・失敗例・KIFをZIPにまとめる。ビルド出力と外部教師バイナリは含めず、固定取得手順で復元する。
