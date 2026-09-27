# Phase 0fの再開・再現

`engines/shogi-search-lab` で実行する。x86_64・AVX2/BMI2、g++、make、Python標準ライブラリを利用する。固定上流と重みは同梱済み。

## ビルド

必要なバイナリがない場合だけ順番に実行する。

```bash
make -j2
python3 scripts/build_phase0d_shared.py
python3 scripts/build_phase0f_shared.py
```

Phase 0dは旧実装との比較用、Phase 0fが今回の切替実装。合法手と中断経路の再生には `build/shogi-lab` を使う。各ネイティブビルドは最大2プロセス、180秒でプロセス群も停止する。既存結果の再開では再ビルドしない。

## 最初の4局面

```bash
python3 scripts/run_phase0f_stress.py compare
```

1回につき新規1局面、7設定を直列に実行し、1探索ごとに保存する。計4回で揃う。中断結果も保存するが、`target_completed` は深さ2が完了した場合だけtrueになる。

続いて次を計4回、同じく1局面ずつ実行する。

```bash
python3 scripts/run_phase0f_stress.py diagnose
```

全候補の全幅参照が未完了なら、完成したαβが選んだ各異なる手を1手ずつ固定して全幅探索する。今回は各局面1手だった。別途、2ノード強制中断→position再設定なしの再探索を実施する。

```bash
python3 scripts/summarize_phase0f.py
```

## 追加の過去失敗局面

最初の4局面のmanifestを読み、同じバイナリ・条件で実行する。追加結果は別ディレクトリに保存する。

```bash
python3 scripts/run_phase0f_hard.py compare
python3 scripts/run_phase0f_hard.py diagnose
python3 scripts/summarize_phase0f.py --out results/v1.0-phase0f-hard
```

この追加局面では全候補の全幅が完成したため、選択手だけの追加探索は不要だった。比較7探索と中断・復元2探索で完了している。

すべて完了済み。同一のコード・バイナリ・条件なら、再実行は `new_positions: 0` を返す。

## 別環境での測り直し

再ビルド等でハッシュが変わる場合は別の出力先を使う。

```bash
python3 scripts/run_phase0f_stress.py compare --out results/v1.0-phase0f-rerun
python3 scripts/run_phase0f_stress.py diagnose --out results/v1.0-phase0f-rerun
python3 scripts/summarize_phase0f.py --out results/v1.0-phase0f-rerun
python3 scripts/run_phase0f_hard.py compare --base-out results/v1.0-phase0f-rerun --out results/v1.0-phase0f-hard-rerun
python3 scripts/run_phase0f_hard.py diagnose --base-out results/v1.0-phase0f-rerun --out results/v1.0-phase0f-hard-rerun
python3 scripts/summarize_phase0f.py --out results/v1.0-phase0f-hard-rerun
```

最初のcompare／diagnoseはそれぞれ計4回必要。時間切れ等で完了状況が変わった場合は同深さの比較だけを解釈し、保存済みの削減率をそのまま引き継がない。

## 設定と検証範囲

`Phase0MoveOrder=lexical|main|q|tactical`。既定はlexical。今回の全設定は主探索深さ2、通常の静止探索予算2、40万ノード・3秒、最大ply8での中断を維持する。安全上限での中断経路は、王手状態と残り予算も含めて保存する。

main/qの切替は読み順だけを変える。標準YaneuraOuの探索経路は別で、今回の4方式比較には含めていない。`checked:true` は保存された完了／中断の整合性確認を指し、深さ2完了や棋力改善を意味しない。

[結果・反例・次の再開点](REPORT-v1.0-phase0f-stress.md)
