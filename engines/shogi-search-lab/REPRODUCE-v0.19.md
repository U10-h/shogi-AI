# v0.19 再現手順

GCC C++17、GNU Make、Node.js、Python 3（図はmatplotlib）。作業ディレクトリは `engines/shogi-search-lab`。

## 比較用バイナリ

旧版を別の作業コピーでビルドする。`checkpoints/v0.18/Makefile` と同フォルダの `src/` の4ファイルを、そのコピーの元の場所へ戻して `make -B -j4` を実行する。ほかのソースとモデルは共通。旧バイナリを現在のコピーの `build/shogi-lab-v0.18` へ置く。

現在のコピーでは `make -B -j4 && make test`。計測開始後はどちらのバイナリも上書きしない。今回の基礎115・継続探索1,274・拡張5,669、合計7,058チェックを記録した。

```sh
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/fetch_opponent.py "$YANEURAOU_ASSETS" --check-only
./build/shogi-lab --advanced --driver adaptive \
  --eval nnue --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \
  --features tt,history,killer,counter,mate-distance,qsearch,capture-history,qcache \
  --qcache-scope entry --qcache-min-nodes 1 \
  --policy-model models/v0.17/all-policy.txt --policy-mode root \
  --time-ms 5000 --max-nodes 1000000000
```

これは入口保存候補の起動例。`qcache`をfeaturesから外すと新ビルドの標準比較方式になる。`all`・閾値1は従来の保存、閾値8/32は軽い読みを保存対象から除く。深さ・上位候補数の制限にはならない。`completed_depth`は費用反復数であり、読み切った手数ではない。`has_result=false`なら初回比較は未完了で、`fallback_pv`は暫定手。

## 再測定

結果は新しいディレクトリに出す。freeze時のバイナリ・評価モデル・根方策・相手WASMのハッシュと一致しないと探索スクリプトは停止する。

```sh
set -e
export V19_RESULTS="$PWD/results/v0.19-repro"
node scripts/experiment_v19.mjs freeze
node scripts/verify_v19.mjs
node scripts/overhead_v19.mjs
node scripts/experiment_v19.mjs dev
node scripts/experiment_v19.mjs score-dev
node scripts/experiment_v19.mjs select
node scripts/experiment_v19.mjs collect
node scripts/experiment_v19.mjs diagnose
node scripts/experiment_v19.mjs test
node scripts/experiment_v19.mjs score-test
node scripts/matches_v19.mjs 0
node scripts/matches_v19.mjs 1
node scripts/matches_v19.mjs 2
node scripts/matches_v19.mjs 3
python3 scripts/summarize_v19.py
python3 scripts/metrics_v19.py
node scripts/audit_v19.mjs
node scripts/viewer_v19.mjs
python3 scripts/plot_v19.py
```

開発の選択規則は平均教師候補差、同点なら完了反復数、さらに同点なら規定順。教師の詰み評価を含む局面はcp平均から外す。標準/root、閾値8/32、入口保存1/8の5方式から選び、従来保存/legacyは診断用。実験当日はentry1が選ばれた。観戦ファイルと図はselection.jsonの候補名を使う。報告書生成スクリプトreport_v19.pyは今回の結論専用で、追試結果には考察の再確認が必要。

`collect`はseed 19301–19304から教師による64手の進行を生成し、24/40/56手後を採取する。最初の20手だけ深さ8の上位3候補・100cp以内から乱択する。4進行内の局面は相関しており、学習との完全非重複も保証しない。教師採点は全方式・全予算の選択手を共通集合にし、教師自身の手を加えて深さ12・MultiPVで行う。候補差はその集合に対する近似であり真の損失ではない。

当日のCPU割当は8コア相当。開発・本局面測定はコア7、対局4組はコア0–3、固定ノード互換性は4、教師進行生成は5、時間比較・難所診断は6へ固定。同じ先後・時間の2方式は同じコアで順に指す。順序は組ごとに逆転する。各探索のモデル読込は時間制限の外だが実際の経過時間も棋譜に残す。

対局・比較ブロックは完了単位で保存する。対局スクリプトは保存済み手順を再生して再開でき、再開位置をJSONへ記録する。二重起動しない。教師/自作とも毎手探索状態をリセットする。時間測定ではOS等の影響による手順差があり、勝率の断定には使わない。
