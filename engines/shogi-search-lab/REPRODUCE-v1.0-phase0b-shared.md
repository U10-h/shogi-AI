# Phase 0bの再開・再現

`engines/shogi-search-lab` で実行する。x86_64・AVX2/BMI2対応、g++、make、Python標準ライブラリを使う。ネットワーク取得は不要。

## ビルド

```bash
make -j2
python3 scripts/build_phase0_native.py
python3 scripts/build_phase0b_shared.py
```

Phase 0aのバイナリが既にある場合、2行目は省略できる。古い結果を再開する際は、バイナリを再ビルドしない。
両ビルドとも最大2コンパイルプロセス。Phase 0bのビルドは180秒超過で子プロセス群も停止する。
生成先は `build/phase0b/`。探索は同梱された固定上流ソースに対する小さなパッチで接続する。

## 実験は1局面ずつ

以下のコマンドは、それぞれ1回に1局面だけ新たに処理する。

```bash
python3 scripts/run_phase0b_small.py static
```

`completed: 2` になるまで計2回実行する。その後、探索比較を行う。

```bash
python3 scripts/run_phase0b_small.py search
```

こちらも計2回、1局面ずつ。完了後、中断・再開を確認する。

```bash
python3 scripts/run_phase0b_small.py interrupt
```

これも計2回。最後に集計する。

```bash
python3 scripts/summarize_phase0b.py
```

今回は全6チェックポイント（3段階×2局面）が完了済み。同じ環境・バイナリ・コードのまま再実行すると、完了済みをスキップする。
1局面の各方式は直列実行。1探索の内部上限は深さ3・40万ノード・3秒、外部応答待ちは8秒。
`go infinite` の停止待ちは検証スクリプト側が `stop` を送って終了させる。

## 新しい環境で測り直す

再ビルドやコード変更でハッシュが変わる場合、保存済み結果へ継ぎ足さず、`--out` で別の結果ディレクトリを指定する。

```bash
python3 scripts/run_phase0b_small.py static --out results/v1.0-phase0b-rerun
```

同じ `--out` をsearch、interrupt、集計にも指定する。局面は固定の `experiments/phase0b-positions.json` から読み込む。
manifestには入力、バイナリ、重み、上流パッチ、コンパイラ、オプションを記録する。条件が変わった場合には既存チェックポイントの利用を拒否する。

## 実装の場所と次の再開点

- 最小探索: `native/phase0b_search.cpp`
- 共通バイナリの構築: `scripts/build_phase0b_shared.py`
- 段階実行: `scripts/run_phase0b_small.py`
- 集計: `scripts/summarize_phase0b.py`

`Phase0Search=standard` が既定。今回の最小探索は、既存v0.xの全機能を移植したものではない。
次は同じ2局面・主探索深さ2・静止探索上限2で、限定静止探索の接続を確認する。大量対局や学習データ生成はまだ行わない。
