# 研究総括・追加検証の再現

対象ソース: `4f94f7baf775c4c3870e5d9863536305b4902deb` (v0.20)。
追加したのは実験・集計・監査・報告のスクリプト。探索コードとモデルの変更なし。

## 一次測定

作業ディレクトリは `engines/shogi-search-lab`。GCC/C++17、Make、Node.js、Python/NumPyが必要。

```sh
set -euo pipefail
make -j4
make test | tee build/selftests.txt
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/fetch_opponent.py "$YANEURAOU_ASSETS" --check-only
export V21_RESULTS="$PWD/results/retrospective-reproduction"
node scripts/retrospective_v21.mjs freeze
node scripts/retrospective_v21.mjs all
node scripts/matches_startpos_v21.mjs
node scripts/diagnose_retrospective_v21.mjs
python3 scripts/summarize_retrospective_v21.py
node scripts/audit_retrospective_v21.mjs
```

評価資材がない場合は `fetch_opponent.py` を `--check-only` なしで実行する。
`freeze` は既存protocolの上書きを拒否する。実験は一度に1プロセスだけ実行し、同じ出力先で二重起動しない。
`all` は collect → speed → quality → score → hard → matches を直列実行する。各段階名を個別指定してもよい。
完了ブロックを保存し、途中から再開できる。対局は毎手探索状態を作り直すため、再開時も全棋譜を渡す。

### 設計

- 新しい8乱数種から28/44/60手後、計24根。同じ進行の3根には相関がある。
- 共通基盤・同じ固定NNUE/cacheで5方式。従来PVS、駒取り履歴、LMR、adaptive、adaptive＋学習根方策。
- 0.3/1/3秒×5方式×24根＋最新5秒×24根＝384探索。
- 10万ノード×cacheなし/cacheあり/scalar＋全件整列×24根×3反復＝216探索。
- 既知終盤6根×5方式×1/3秒＝60探索。合計660探索（教師生成・教師採点・対局を除く）。
- 内部比較は3比較×6開始局面×先後＝36局、200ms/手。
- 対やねうら王は2構成×2開始局面×先後＝8局、双方1秒/手。
- 生成開始のうち1局面が+2,092cp有利だったため、相手との対局結果を見る前に平手初期から4局を追加。開始条件を分けて集計し、対局は合計48局。
- 先後は色の交換であり、同一開始局面を盤面反転する操作ではない。
- 追加200手上限は未決着。時間超過を即負けにはしない。探索時間と起動込み応答時間を別記。
- 対戦相手は固定YaneuraOu NNUE KP256 6.03 WASM。最新強豪との比較ではない。
- 原データのノードには静止探索・再訪問が含まれ、ユニーク局面数ではない。

## 事後診断

```sh
node scripts/diagnose_retrospective_v21.mjs
```

深さ12で大きく改善・悪化した局面と時間延長で着手が変わる局面から7根を選び、同じ候補集合を深さ16で再採点する。
これは結果を見た後の感度分析であり、未使用局面の試験ではない。選択理由はdepth16/protocol.json。
診断のために方式・モデル・パラメータを調整しない。

## 集計の注意

速度は局面別3反復の中央値を合計した比。8進行単位のbootstrap 10,000回。
候補差の対応区間も進行単位で再標本化し、採用された根の差の合計÷根数を各再標本で計算する。
特殊値/詰みが1根に含まれるため、cp比較は23根。根数が異なる進行を単純に等重み平均する処理は使わない。
各方式・各時間の着手を同じ集合で教師採点する。時間を増やした行を別の候補集合で比べない。
小標本・複数比較の探索的結果であり、Eloや一般的な棋力差の検定として扱わない。

## ファイル

- `summary.json`, `quality-summary.csv`:主要な集計
- `quality.csv`, `speed.csv`, `hard.csv`, `games.csv`, `match-moves.csv`:再解析用の表
- `protocol.json`, `environment.json`:固定条件・実行環境・ハッシュ
- `roots.json`, `trajectories/`:開始履歴と局面生成
- `quality/`, `speed/`, `hard/`:個々の探索結果
- `teacher/`, `*-usi.jsonl`:教師の全応答
- `matches/`:対局JSONとKIF
- `audit.json`, `manifest.json`:独立再生の監査とファイルSHA-256
- `historical-inventory.json`:過去報告書・集計の存在確認とハッシュ

生データは同ディレクトリの `raw-results.tar.gz` に格納した。リポジトリ直下から次で展開できる（既存の今回データと同じ内容を展開するため、解析用の別checkoutを推奨）。

```sh
tar -xzf engines/shogi-search-lab/results/retrospective-20260927/raw-results.tar.gz -C engines/shogi-search-lab/results/retrospective-20260927
```

実行途中に保存JSONとKIFの進捗不一致を検出したため、処理を停止し、3局を保存された全履歴の続きから再開した。毎手fresh/resetの設計は維持した。元のKIF2件も `recovery/` に保持し、再開後の棋譜との完全一致を確認した。停止・再開位置は `execution-events.json` と各対局の `resumptions` に記録した。結果に基づく開始局面の選別や未完了局の破棄はしていない。再開3局を除く事後補助集計では、駒取り履歴対従来PVSは7勝3敗、最新対LMRは6勝5敗である。

`report_retrospective_v21.py` は集計、監査、解釈文 `interpretation.json` からMarkdown・図・PDFを作る。
PDFにはReportLab/Matplotlibと日本語TrueTypeフォントを使う。`REPORT_ASSETS`にNotoSansJP-400.ttf/700.ttf、`REPORT_OUTPUT`に出力PDFを指定できる。
環境依存の探索時間や固定時間の着手の完全一致は保証しない。今回の原記録は上書きせず、新しい出力先に追試する。
