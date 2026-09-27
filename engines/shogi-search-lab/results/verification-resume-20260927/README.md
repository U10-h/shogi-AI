# 2026-09-27 検証再開結果

前回の48対局・660探索は完了済みで、未完了対局は0件だった。原記録354ファイルを照合し、独立ルール実装で全棋譜/PVを再生した。
この追試では216探索を新規実行し、既存24根の47候補をすべて深さ16で再採点した。新規対局は0局。

- 評価cacheは同値な探索結果を保ち、探索時間8.19%短縮（前回8.84%）。
- 最新3秒対駒取り履歴3秒は、共通21根で教師深さ12の候補差-37.33cpから、深さ16では+4.76cpに変化。最新方式の優位は維持されない。
- `1-44`（特殊値）、`1-60`（詰み）、`4-60`（詰み）は通常cpの平均から根全体を除外。
- 既存の選択7根について、深さ16候補スコアは全件再現。
- 速度の72対応ブロックは、3方式間でも元の記録とも全件同値。

詳しい結果・限界は `../../REPORT-verification-resume-20260927.md`。
`summary.json`の`prior_summary`は前回の結果を再掲したもので、新規測定として数えない。
`raw-results.tar.gz`にはこのディレクトリの監査対象ファイルを保存。原データ用ディレクトリはGitではアーカイブ内に格納している。

## 再現

作業ディレクトリは `engines/shogi-search-lab`。必要ソフトはGCC/C++17、Make、Node.js、Python/NumPy。
PDF生成にはReportLab/fontToolsとNotoSansJPの可変TrueTypeフォントが必要。

```sh
set -euo pipefail
make -j4
make test > build/resume-selftests.txt
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/fetch_opponent.py "$YANEURAOU_ASSETS" --check-only
export V21_PRIOR="$PWD/results/retrospective-replay-input"
mkdir -p "$V21_PRIOR"
tar -xzf results/retrospective-20260927/raw-results.tar.gz -C "$V21_PRIOR"
V21_RESULTS="$V21_PRIOR" node scripts/audit_retrospective_v21.mjs
export V21_RESUME="$PWD/results/verification-reproduction"
node scripts/resume_verification_v21.mjs all
python3 scripts/summarize_resume_v21.py
```

速度比較と教師採点は直列。途中再開は同じコマンド。別のバイナリ・資材・元候補・実験コードが検出されると停止する。
`run.lock`が残った場合は元プロセスの終了を確認してから削除する。結果を見て失敗局面だけを省略しない。

集計は局面別中央値と8進行単位bootstrap 10,000回。全24根のうち通常cpの集合は21根。
深さ12との共通集合は同じ21根であり、標本集合の違いを混ぜずに比較する。
原教師の47候補集合を維持した感度分析であり、教師の全合法手探索の厳密な最善手損失ではない。

PDFとMarkdownの再生成:

```sh
export REPORT_ASSETS=/path/to/fonts
# REPORT_ASSETS/NotoSansJP-variable.ttf を配置する
export REPORT_OUTPUT=/path/to/将棋AI研究_検証再開結果_20260927.pdf
python3 scripts/report_resume_v21.py
```

日付と過去成果の説明文は本追補用。測定は環境依存なので、追試結果が変わった場合は解釈文も更新する。
