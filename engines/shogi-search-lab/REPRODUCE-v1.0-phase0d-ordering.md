# Phase 0dの再開・再現

`engines/shogi-search-lab` で実行する。x86_64・AVX2/BMI2、g++、make、Python標準ライブラリを使う。固定上流ソース・重みは同梱済み。

## ビルド

必要なバイナリがない場合だけ、順番に実行する。

```bash
make -j2
python3 scripts/build_phase0c_shared.py
python3 scripts/build_phase0d_shared.py
```

合法手確認には `build/shogi-lab`、比較基準には `build/phase0c/`、今回の実装には `build/phase0d/` を使用する。各ネイティブビルドは最大2プロセス、180秒で子プロセス群も停止する。既存結果を再開するときは再ビルドしない。

## 1局面ずつ実行

```bash
python3 scripts/run_phase0d_small.py compare
```

1回につき新規1局面、7設定を直列で実行する。`completed: 2` になるまで計2回。その後に中断・復元確認を行う。

```bash
python3 scripts/run_phase0d_small.py control
```

これも計2回、1局面につき5探索。最後に集計する。

```bash
python3 scripts/summarize_phase0d.py
```

今回は4チェックポイントが完了済み。同じ環境・コード・バイナリなら完了分をスキップし、`new_positions: 0` を返す。異常時は `failed/` にログを残し、成功チェックポイントとして採用しない。

比較設定は旧／新標準、旧αβ、新辞書順αβ、新辞書順全幅、新優先順全幅、新優先順αβ。すべて深さ2、通常の静止探索予算2、40万ノード・3秒を上限とする。同点で選択手が変わる場合だけ、選択された手を個別に固定した全幅探索を追加する。

## 別環境・再ビルド後

ハッシュが変わる条件を既存結果に混ぜない。別の出力先で、compareとcontrolをそれぞれ2回実行する。

```bash
python3 scripts/run_phase0d_small.py compare --out results/v1.0-phase0d-rerun
python3 scripts/run_phase0d_small.py control --out results/v1.0-phase0d-rerun
python3 scripts/summarize_phase0d.py --out results/v1.0-phase0d-rerun
```

入力は固定の `experiments/phase0b-positions.json`。manifestは開始時コミットと対象ソース・バイナリのSHA-256を保存し、結果保存後も開始時コミットを保持する。

## USI設定

既存の `Phase0Search=standard|alphabeta|minimax`、`Phase0Audit`、`Phase0QSearch`、`Phase0QDepth` に加え、`Phase0MoveOrder=lexical|tactical` を追加した。既定はlexical。標準探索はこのオプションを使用しない。runnerが対応するThreads=1、入玉判定なし等の設定を行う。

- 実装：`native/phase0d_search.cpp`
- ビルド：`scripts/build_phase0d_shared.py`
- 実行：`scripts/run_phase0d_small.py`
- 集計：`scripts/summarize_phase0d.py`
- [結果と次の再開点](REPORT-v1.0-phase0d-ordering.md)

次は事前に固定した中盤1局面へ進む。深さやノード上限は増やさず、全幅が予算内に完了するかを先に確かめる。
