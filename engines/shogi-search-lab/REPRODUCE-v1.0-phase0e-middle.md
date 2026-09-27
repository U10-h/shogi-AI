# Phase 0eの再開・再現

`engines/shogi-search-lab` で実行する。x86_64・AVX2/BMI2、g++、make、Python標準ライブラリを使用する。

## バイナリ

今回の測定は既存のPhase 0dバイナリを再利用し、エンジンを変更していない。バイナリがない環境のみ、次を実行する。

```bash
make -j2
python3 scripts/build_phase0d_shared.py
```

`build/shogi-lab` は合法手確認用。比較には `build/phase0d/` のみを使う。Phase 0cバイナリは不要。既存測定を再開するときは再ビルドしない。

## 1設定ずつの比較

```bash
python3 scripts/run_phase0e_middle.py compare
```

1回に1設定を処理・保存する。計4回で辞書順全幅、優先順全幅、辞書順αβ、優先順αβが揃う。全幅は40万ノードで深さ1の結果に戻った。`checked:true` は中断・復元等の検証を通過した意味であり、深さ2完了は別の `target_completed` を確認する。

比較が4設定揃った後、中断・復元を検証する。

```bash
python3 scripts/run_phase0e_middle.py control
```

こちらも1回1設定、計4回。1設定につき、2ノードで中断→position再設定なしで通常探索→もう一度通常探索の3探索を直列で実施する。

## 選択手の限定照合と集計

```bash
python3 scripts/verify_phase0e_selected.py
python3 scripts/summarize_phase0e.py
```

選択手の照合は、完成した両αβが同じ手・評価を返すことを前提に、その1手を固定した全幅探索を1回だけ実行する。全候補の最適性は証明しない。この診断のスクリプトと比較入力のハッシュは結果ファイルに別途保存する。

今回のcompare 4件、control 4件、選択手1件は保存済み。同じ条件での再実行は `new_searches: 0` を返す。1探索ごとに40万ノード・3秒、外部応答待ちは8秒。探索プロセスは同時に1つだけ起動する。

## 再ビルド・別環境

ソースやバイナリ、環境等のハッシュが変わる場合、既存結果への継ぎ足しを拒否する。新しい出力先を各コマンドに指定する。

```bash
python3 scripts/run_phase0e_middle.py compare --out results/v1.0-phase0e-rerun
python3 scripts/run_phase0e_middle.py control --out results/v1.0-phase0e-rerun
python3 scripts/verify_phase0e_selected.py --out results/v1.0-phase0e-rerun
python3 scripts/summarize_phase0e.py --out results/v1.0-phase0e-rerun
```

compareを計4回終えてからcontrolを計4回行う。現在の集計器は今回の観測（全幅がノード上限で深さ1、αβが深さ2）を検査する。別環境で時間上限が先に発動する場合、結果は保存されるが同じ結果として集計しない。

入力は `experiments/phase0e-positions.json`。ソース・重み・バイナリ・オプション・入力を `manifest.json` に固定し、途中停止後も完了チェックポイントをスキップして続行できる。

[結果・制限・次の小規模実験](REPORT-v1.0-phase0e-middle.md)
