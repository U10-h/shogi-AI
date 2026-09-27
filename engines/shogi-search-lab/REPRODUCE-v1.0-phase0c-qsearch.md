# Phase 0cの再開・再現

`engines/shogi-search-lab` で実行する。x86_64・AVX2/BMI2対応、g++、make、Python標準ライブラリを使う。同梱の固定上流ソースと重みを利用するため、ネットワーク取得は不要。

## ビルド

必要なバイナリがない場合にだけ、次を順番に実行する。

```bash
make -j2
python3 scripts/build_phase0b_shared.py
python3 scripts/build_phase0c_shared.py
```

合法手確認用の `build/shogi-lab`、旧比較用の `build/phase0b/`、今回用の `build/phase0c/` を使う。既存結果の再開時には再ビルドしない。ネイティブビルドは最大2コンパイルプロセス、各180秒超過で子プロセス群も停止する。

## 同じ環境で再開

次を1回実行すると、新たな1局面だけについて6設定の比較を直列実行する。

```bash
python3 scripts/run_phase0c_small.py compare
```

`completed: 2` になるまで計2回。その後、同様に中断・復元確認を行う。

```bash
python3 scripts/run_phase0c_small.py control
```

こちらも計2回、1局面につき5探索。最後に集計する。

```bash
python3 scripts/summarize_phase0c.py
```

今回の4チェックポイントは完了済み。同じ環境・ソース・バイナリなら、上のcompare/controlは完了済みをスキップし、`new_positions: 0` を返す。1局面分が終わったところで保存し、失敗・中断した局面は再実行する。

比較では主探索深さ2・通常の静止探索予算2、40万ノード・3秒。静止探索の王手回避は予算0以下でも継続し、非終端の絶対ply8で反復を中断する。1探索の応答待ちは8秒。controlでは2ノードでの打切りと、`go infinite`への`stop`を別々に確認する。

## 別環境・再ビルド後の測り直し

条件のハッシュが変わった場合は既存結果への継ぎ足しを拒否する。別の出力先を指定し、同じく1回に1局面ずつ進める。

```bash
python3 scripts/run_phase0c_small.py compare --out results/v1.0-phase0c-rerun
```

compareを計2回実行した後、同じ出力先でcontrolを計2回実行し、集計する。

```bash
python3 scripts/run_phase0c_small.py control --out results/v1.0-phase0c-rerun
python3 scripts/summarize_phase0c.py --out results/v1.0-phase0c-rerun
```

入力は固定の `experiments/phase0b-positions.json`。manifestは実験開始前のGitコミットと対象ソース・バイナリのハッシュを記録する。結果を保存するコミットを作った後も、既存manifestの開始前コミットを保持して再開できる。

## USI設定と実装

| オプション | 既定 | 用途 |
|---|---|---|
| `Phase0Search` | `standard` | `alphabeta`または`minimax`で最小探索へ切り替え |
| `Phase0Audit` | `false` | `true`で各評価を全再計算と照合 |
| `Phase0QSearch` | `false` | 最小探索の葉で静止探索を有効化 |
| `Phase0QDepth` | `2` | 非王手時の通常予算、設定範囲0〜2 |

runnerがThreads=1、全合法手生成、入玉判定なし等の対応設定を行う。標準探索は従来の経路を維持する。

- 探索：`native/phase0c_search.cpp`
- ビルド：`scripts/build_phase0c_shared.py`
- 実行：`scripts/run_phase0c_small.py`
- 集計：`scripts/summarize_phase0c.py`
- [結果・制限・次の実験](REPORT-v1.0-phase0c-qsearch.md)

次は同じ2局面に駒取り・成り優先の読み順だけを追加する。主探索深さ・通常の静止探索予算を増やさず、1局面ずつ全幅との評価一致を確認する。
