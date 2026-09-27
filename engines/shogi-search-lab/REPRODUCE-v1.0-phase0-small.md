# Phase 0aの小規模実行・再開

作業場所: `engines/shogi-search-lab`。Python標準ライブラリ、g++、makeを使用する。
固定ソースとNNUEはリポジトリ内の `dist/vendor/yaneuraou/corresponding-source.zip` から取得する。追加ダウンロードは不要。
ネイティブビルドはx86_64のAVX2/BMI2対応CPU向け。CPU設定を変える場合は別実験として記録する。

## ビルド

```bash
make -j2
make test
python3 scripts/build_phase0_native.py
```

ネイティブ側も最大2ビルドプロセス。ビルド上限は180秒。生成物・ログは `build/phase0/`。
実験に用いたバイナリ・重み・入力・コンパイラ等の情報は `results/v1.0-phase0/manifest.json` に記録している。
自作の学習モデルや探索ルールの変更は不要。

## チェックポイントから再開

**1回に既定1局面、最大2局面。** 次のコマンドを一つずつ実行し、出力の `complete_pairs` を確認する。

```bash
python3 scripts/run_phase0_small.py eval --max-new 2
```

`complete_pairs: 6` になるまで上のコマンドを最大3回実行する。完了済みはスキップする。
6局面すべての評価一致が通ったら、次の段階へ進む。

```bash
python3 scripts/run_phase0_small.py nodes --max-new 2
```

同様に最大3回、2局面ずつ実行する。完了後、時間指定比較を行う。

```bash
python3 scripts/run_phase0_small.py time --max-new 2
```

この段階も最大3回。どの段階でもエンジンは直列実行し、1探索の応答上限は8秒。
最後に集計と中断・再開の検証を行う。

```bash
python3 scripts/summarize_phase0_small.py
python3 scripts/verify_phase0_harness.py
```

今回は全18ペア（評価6・ノード6・時間6）完了済み。同じ実行環境・同じバイナリでコマンドを再実行すると、新規実行数0を返す。
通常の結果は各段階の局面別JSONへ保存する。エンジン異常時には `.failed.json` を残し、未完了ペアは次回実行の対象になる。

## 別環境で測り直す場合

結果に同梱したmanifestは今回のバイナリ・実行環境に固定されている。別環境で再ビルドした結果を、保存済み結果に継ぎ足してはならない。
**新しいチェックアウト**でビルドし、保存済み結果を退避してから、新しい測定を始める。

```bash
mkdir -p build/phase0
mv results/v1.0-phase0 build/phase0/recorded-results
mkdir -p results/v1.0-phase0
cp build/phase0/recorded-results/positions.json results/v1.0-phase0/positions.json
```

これで局面集合を保ったまま、新しい条件manifestを作成できる。既存のチェックポイントのハッシュを書き換えて再利用しない。
新しい測定は元の報告書の数値を再現するとは限らない。時間測定は各1回の小規模確認であり、速度差の統計評価ではない。

## 次回の研究再開点

今回はPhase 0aまで。次は **Phase 0b: 上流NNUE関数と探索差し替えの接続を、2局面・深さ3で確認する**。
学習・大規模局面生成・長時間対局はまだ行わない。
