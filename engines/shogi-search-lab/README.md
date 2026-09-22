# Shogi Search Lab — 探索研究と対やねうら王の実験

## 深さ・候補数を固定しない選択的探索（v0.16）

読む費用を枝ごとに変える探索と、過去の学習評価を25%だけ反映する仮説・補正上限を設ける仮説を実装しました。6設定・384探索、双方1手1秒でやねうら王との16対局を保存しています。最大到達手数は伸び、一部の着手指標は改善しましたが、各設定0勝4敗で勝率向上は未確認です。また、終盤の6局面では初回反復が時間内に終わらない問題を確認し、同じ局面の24探索で再現しました。標準はv0.15 fastを維持します。

- [結果・反例・対局記録](REPORT-v0.16.md)
- [起動・再現手順](REPRODUCE-v0.16.md)
- [仮説と探索費用の規則](RESEARCH-v0.16.md)
- [16局の棋譜ZIP](results/v0.16/shogi-v0.16-kifu.zip)

```bash
make -j4
export YANEURAOU_ASSETS="$PWD/../../dist/vendor/yaneuraou"
python3 scripts/run_v16.py adaptive --time-ms 3000
python3 scripts/run_v16.py blend --time-ms 3000
python3 scripts/run_v16.py clipped --time-ms 3000
```

## 探索処理の高速化と深さ配分（v0.15）

ユーザー添付のv0.14を基準に、NNUEのSIMD化・差分更新の整理・遅延した手選択を実装しました。新規16根・深さ4・各3反復では、評価値・最善手・PV・ノードを保ち、探索時間を49.9%短縮（2.00倍速）。1秒・3秒の256探索と深さ12の教師評価も保存しています。

推奨は `fast`。既存LMRと新規履歴LMRは実験設定として残しました。完了深さと選択手の品質を分けて比較し、全局対局の勝率向上はまだ主張しません。

- [結果・悪化例・採用判断](REPORT-v0.15.md)
- [文献と実装の対応](RESEARCH-v0.15.md)
- [起動・再現手順](REPRODUCE-v0.15.md)
- `results/v0.15/`：全探索・教師評価・検証・CSV・凍結プロトコル。

```bash
make -j4
export YANEURAOU_ASSETS="$PWD/../opponent"
python3 scripts/run_v15.py fast --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
# USI接続: python3 scripts/run_v15.py fast --usi
```

## 読み順の学習とLMRの再評価（v0.14）

過去版の結果を踏まえ、NNUEを固定して、教師からの読み順の事前学習と、探索中の駒取り履歴学習を実装しました。新規21局面・252着手比較・252固定深さ探索・先後交換48対局まで検証しています。

推奨は駒取り履歴版。基準に13勝3敗、深さ3の評価値・最善手は全21根で一致し、ノード6.45%減。探索時間は測定上8.78%短縮しましたが参考区間は改善なしを含みます。履歴＋LMRは11勝5敗。事前学習併用は10勝6敗でしたが、1秒の局面比較に大きな悪化例が残るため標準採用を見送りました。

- [全結果・同点手の悪化例・採用判断](REPORT-v0.14.md)
- [過去版と一次ソースからの設計](RESEARCH-v0.14.md)
- [再現方法・起動方法](REPRODUCE-v0.14.md)
- [事前学習モデルカード](models/v0.14/MODEL_CARD.md)
- `results/v0.14/`：学習・不採用試行・全48局のKIF・新規比較・固定深さ測定・診断・CSV。
- `checkpoints/v0.13/src/` と `CHANGES-v0.14.patch`：変更前の探索と今回の差分。

```bash
make -j2
export YANEURAOU_ASSETS="$PWD/../opponent"
python3 scripts/run_v14.py capture --depth 16 --iterative --time-ms 1000 --max-nodes 1000000000
# USI: python3 scripts/run_v14.py capture --usi
# LMR併用: capture を selective へ変更
```

## 文献に基づく学習型枝刈り（v0.13）

α更新リスクと探索コストを学習する2モデルを実装しました。予測のみ、保護条件、浅い確認、コスト学習、厳しい閾値を比較し、新規24局面・384着手比較・576固定深さ探索・96監査・32先後交換対局まで評価しました。

保守的な版はノード0.17%減に対して探索時間比1.0227（95%参考区間0.963〜1.049）。同一ノード条件の24局面では基準と同じ手でしたが、新規監査182省略中1件の見落としが残り、対基準7勝9敗、対delta12勝4敗。速度・棋力向上を確認できていないため、既定の枝刈りはoffを維持しています。

- [実験結果・失敗例・判断](REPORT-v0.13.md)
- [一次文献と設計の対応](RESEARCH-v0.13.md)
- [再現手順](REPRODUCE-v0.13.md)
- [比較図](results/v0.13/overview.png)
- [モデルカード](models/v0.13/MODEL_CARD.md)
- [探索実装の差分](CHANGES-v0.13.patch)
- `results/v0.13/`：1,301,318教師ラベル、校正・開発・新規評価の全結果、32局のKIF、監査と反例。

## 候補間の評価差学習と、探索の葉の観測（v0.12）

同じ根の候補間の差を学習するNNUE後段を実装しました。新規24進行の3,676候補ペア、22局面×5モデル×2予算＝220探索、先後交換64対局で検証しています。候補差MAEは586.97→555.11cpに減りましたが、順位正解率は60.28→60.48%で、棋力改善は確認できません。単純な倍率補正でも誤差が減るため、標準モデルへの昇格は見送りました。

`--leaf-trace PATH`で静止探索の評価・親子関係・α/β・終了理由を記録できます。学習集合では平均補正がほぼ0でも、探索の葉では−103.70cpになりました。悪化した1局面では、このモデルだけ反復深化の深さ3を完了できず、475ノード追加すると他モデルと同じ手に修正されました。

- [全結果と考察](REPORT-v0.12.md)
- [再現方法・葉の記録](REPRODUCE-v0.12.md)
- [比較図](results/v0.12/overview.png)
- [モデルカード](models/v0.12/MODEL_CARD.md)
- `results/v0.12/`：学習・不採用試行・64局のKIF・220探索・32本のトレース・CSV・検証証拠。
- `checkpoints/v0.11/src/`：変更前の探索ソース。`CHANGES-v0.12.patch`に今回の探索差分。

## 継続実験：単純補正との対照・探索打切りの改善（v0.11）

前回の学習済み評価関数を固定し、新規63局面・237探索・先後交換128対局で元評価と単純+40cp補正を比較しました。通常の12,000ノード条件では、学習版対元評価が18勝13敗・未決着1、単純補正対元評価が17勝14敗・未決着1、学習版対単純補正が14勝18敗。追加学習の優位性は確認できませんでした。4倍ノード条件、参考区間、開始局面の偏りは報告書に記録しています。

初回反復未完了時に読み終えた根候補を使う処理を追加しました。過去の打切り局面のうち通常cpで比較できる20局面は18改善・1同等・1悪化。教師候補との差は平均1,340→233cp。未完了結果を完了済みスコアとして扱わず、JSONの `fallback_*` に分離しています。

- [実験結果・考察・限界](REPORT-v0.11.md)
- [再現手順](REPRODUCE-v0.11.md)
- [探索実装の差分](CHANGES-v0.11.patch)
- `results/v0.11/`：全対局・KIF・局面比較・打切り診断・図・CSV・検証記録。
- `checkpoints/v0.10/src/`：変更前の4ソース。評価関数の重みは前回のまま固定。


## 機械学習による評価関数の再構築（v0.10）

192の対局進行から56,805局面を作り、既存NNUEの後段32→32→1を追加学習しました。最初の直接回帰は探索品質を悪化させたため、補正幅の制限・Huber損失・元パラメータへの正則化を導入して再構築しました。

固定後の最終評価では、静的誤差727→709cp（2.45%減）、旧評価との対局25勝7敗（先後交換、各手12,000ノード）。1秒96局面では改善5・同等87・悪化4、3秒24局面では改善1・同等23・悪化0でした。探索改善は少数局面によるため、未知戦型や長時間での棋力向上は未確定です。

- [全結果・失敗の観察・再構築・限界](REPORT-v0.10.md)
- [再現方法と学習済みモデルの起動](REPRODUCE-v0.10.md)
- [モデルカード](models/v0.10/MODEL_CARD.md)
- `models/v0.10/`：学習済みヘッドとチェックポイント。完全モデルへの書き出しには固定基盤が必要です。
- `results/v0.10/`：全データ、学習曲線、120探索比較、32局のKIF、検証、測定修正の記録。

```bash
python3 scripts/export_ml_model.py \
  --base "$YANEURAOU_ASSETS/yaneuraou.data" \
  --head models/v0.10/anchored50.npz \
  --output build/models/v0.10/anchored50.nnue
./build/shogi-lab --advanced --preset tactical --eval nnue \
  --eval-model build/models/v0.10/anchored50.nnue \
  --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
```

探索本体はv0.9と共通です。ニューラルネット全体を一から学習したものではなく、凍結した特徴変換に対する1,089パラメータの追加学習です。

## 探索処理の改善・実験・再改善（v0.9）

静止探索の捕獲・成りを直接生成し、同点の並べ替えを整数化しました。実験で静的評価による打切りが多いと確認した後、合法手の存在を確認できた局面では手生成を後回しにする改善を追加しました。

同じ探索結果で旧v0.8より処理時間19.6%短縮。1手3秒の12局面では、探索ノード数が17.7%増え、教師評価による着手は1局面改善・11局面同等でした。旧版との対局は4勝0敗（双方150ms、少数局の参考結果）。途中で最初の反復を完了できない局面が見つかり、比較スクリプトにも既存USIと同じ合法手による代替処理を追加しました。

- [全結果・考察・実験条件・再現方法](REPORT-v0.9.md)
- `results/v0.9/`：各段階の生データ、CSV、検証、4局のKIF、代替着手と再開の記録。
- `checkpoints/v0.8/`：比較元。`python3 scripts/build_checkpoint.py v0.8`で復元できます。

新しい処理はadvanced/USIで有効です。第1段階との比較には`--eager-qmoves`、ほかの個別比較には`--legacy-order`と`--full-qmoves`を使えます。NNUEの起動例は下記と同じです。

<!-- V08_START -->
## やねうら王とのコード比較とNNUE導入（v0.8）

固定対戦版6.03のK+P型NNUEを自作探索に組み込み、差分計算と不要な評価の省略を追加しました。重みは既存の配布物を利用しています。本家ソースと2,246局面で評価値が一致し、同じ探索結果のままNNUE全再計算版より処理時間を34.6%短縮しました。

手動位置評価版には4勝0敗・引分0・未決着0（双方300ms）、固定やねうら王には0勝2敗・引分0・未決着0（双方3000ms）。小規模な検証であり、Eloや一般的な勝率の推定ではありません。

- [コードの差・改善判断・全検証結果・再現方法](REPORT-v0.8.md)
- `results/v0.8/`：条件、未加工の結果、全6局の棋譜。
- `checkpoints/v0.7/`：変更前のソース。`scripts/build_checkpoint.py v0.7` で再ビルド可能。

```bash
make -j2
python scripts/fetch_opponent.py "$PWD/../opponent"
export YANEURAOU_ASSETS="$PWD/../opponent"
./build/shogi-lab --advanced --preset tactical --eval nnue \
  --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \
  --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
```

推奨は `--eval nnue`。NNUE重みは外部取得です。過去実験との互換性のため既定値materialは維持し、手動位置評価は `--eval positional` で使用できます。

<!-- V08_END -->
## 位置評価の改善（v0.7）

駒得に玉の安全・金銀との距離・飛角の可動範囲など38特徴を追加しました。未知16局面を各3秒で比較すると、手動設定版は従来より8局面で改善、6局面で同等、2局面で悪化し、教師の候補評価との差は平均127.81から93.75へ減りました。勝率や棋力が27%上がったという意味ではありません。

先後交換の実対局では、従来版に6勝2敗（双方1手300ms）。固定版やねうら王には従来版・改善版とも0勝2敗（双方1手3000ms）でした。全12局の棋譜と1138着手の独立検証記録を同梱しています。

学習版も実装しましたが、3秒探索で手の質が悪化したため推奨しません。従来実験の既定値は維持し、改善版は `--eval positional` で選びます。

- [改善方針・学習・同条件比較・実対局・限界・再現方法](REPORT-v0.7.md)
- `results/v0.7/`：事前条件、全教師データ、候補比較、対局棋譜、検証ログ。
- `checkpoints/v0.6/`：変更前の自作ソース。

```bash
make -j2
./build/shogi-lab --advanced --preset tactical --eval positional --depth 16 --iterative --time-ms 3000 --max-nodes 1000000000
./build/shogi-lab --usi --preset tactical --eval positional
```

## 前回の対局実験（v0.6）

やねうら王NNUE KP256 6.03と双方1手3秒で4局を対戦し、0勝4敗でした。12件の局面で4設定も比較しましたが、枝刈り追加による手の質の改善は確認できませんでした。

- [対局結果・敗因診断・再現方法](REPORT-v0.6.md)
- [改善文献8件と実装の優先順位](RESEARCH-v0.6.md)
- `results/v0.6/`：全棋譜・通信ログ・48探索の比較・独立検証結果

探索本体はv0.5、評価は駒得のままです。v0.6は対局・診断環境の追加を指します。

## 探索手法の実装（v0.5）

チェス・将棋・オセロ・チェッカー・LOAなどの先行研究21件から、探索機構をC++17の将棋エンジンへ移植した実験版です。8つの探索ドライバ、24の機能スイッチ、比較実験、ProbCutの係数学習、USI接続を追加しました。

- [研究21件・出典・実装との差分](RESEARCH-v0.5.md)
- [実測結果・見落とし・再現方法](REPORT-v0.5.md)
- `results/v0.5/`：未加工の探索結果、比較表、選択手の再評価、検証ログ

探索の改善を調べるため、評価関数は従来の駒得評価を共通にしています。原著エンジン全体の再現や、対局による棋力向上の証明ではありません。

## 新しい探索を使う

```bash
make -j2
make test

# 同じ葉評価の結果を維持する探索。深さ8を目標に3秒まで反復深化
./build/shogi-lab --advanced --preset exact --depth 8 --iterative --time-ms 3000 --max-nodes 10000000

# 静止探索あり、上位5手
./build/shogi-lab --advanced --preset tactical --multipv 5 --depth 6 --iterative --time-ms 3000 --max-nodes 10000000

# 選択的な枝刈りを組み合わせた実験設定
./build/shogi-lab --advanced --preset selective --depth 8 --iterative --time-ms 3000 --max-nodes 10000000

# MTD(f)。枝刈りを増やさず零窓の反復方式を変更
./build/shogi-lab --advanced --preset exact --driver mtdf --depth 4 --iterative

# 個別の機能だけを指定。--features は追加ではなく全機能集合の置換
./build/shogi-lab --advanced --features tt,history,killer,counter,mate-distance,futility --depth 4 --iterative

# 本実験で推定した固定駒得評価向けモデルを使うProbCut
./build/shogi-lab --advanced --features tt,history,killer,counter,mate-distance,probcut --probcut-model experiments/probcut-v0.5.txt --depth 4 --iterative

# 将棋の実現確率探索の試作。通常のdepthと読みの範囲が異なる
./build/shogi-lab --advanced --driver erps --features qsearch --depth 6 --iterative --time-ms 3000 --max-nodes 10000000

# USI対応GUIから利用する際の起動コマンド
./build/shogi-lab --usi --preset tactical
```

| プリセット | 内容 | 値の扱い |
|---|---|---|
| `baseline` | 通常のαβ | 固定深さ・駒得評価 |
| `exact` | PVS、履歴対応キャッシュ、history、killer、counter、詰み距離境界 | 同じ深さと葉評価のminimaxと照合 |
| `tactical` | exact＋静止探索 | 静止探索を含む別の葉評価 |
| `selective` | tactical＋LMR、検証付きnull、futility、王手延長 | 推測的な枝刈りあり。実験用 |

ドライバは `ab,pvs,aspiration,mtdf,sss,dual,rps,erps`。
機能は `tt,history,killer,counter,iid,etc,mate-distance,qsearch,see-order,see-prune,delta,futility,reverse-futility,razoring,null,adaptive-null,verified-null,lmr,check-extension,recapture-extension,singular,multicut,probcut,multiprobcut`。
すべてを同時投入する前提ではありません。MTD系と選択的枝刈りなど、検証していない組合せは明示的に拒否します。

`--depth` は新探索では0〜16、従来探索では0〜8。`--tt-entries` は値キャッシュの件数上限（既定10万）、`--qdepth` は非王手の静止探索上限（既定6）、`--extensions` は1経路の延長予算（既定2）です。いずれも全体のノード・時間予算に従います。`complete:false` は目標の反復が終わっていないことを示し、返す候補は最後に完了した反復のものです。`leaf_policy` と `selective` を確認して比較してください。

USIは `position`, `go`, `stop`, `isready`, `setoption Preset/MultiPV` と複数PVの出力に対応します。相手番の先読みと専用詰将棋ソルバはありません。時間配分は簡易版で、外部GUIとの対局実績は未測定です。GUI用の実行ファイルに引数を設定できない場合は `--usi` を付ける起動スクリプトを用意してください。

新探索のMultiPVは1回の検索内で上位5候補まで返します。以下の従来モードは、着手後にも部分木を引き継ぐ用途で引き続き使えます。新しい枝刈り群と従来の保持木を混在させる処理は実装していません。

## 従来の継続モード（v0.4）

C++17で探索・駒得評価を自作し、合法手生成に固定版YaneuraOuを使う将棋研究用エンジンです。
**各分析局面で上位5手を保持し、その手が指されたら該当する部分木を新しい根にして探索を続けます。**
今回は候補ごとの評価・深さ・読み筋に加え、探索済みノードの結果も再利用します。

v0.4では、5位に届かないことを同じ深さの零窓探索で確認し、全窓での再探索を省く方式を標準にしました。
制約伝搬との対応、一次資料のレビュー、比較実験、今後の計画は [REPORT-v0.4.md](REPORT-v0.4.md) にまとめています。

## 起動と基本操作

Linux、g++ 13、GNU Makeで動作確認しています。追加ダウンロードは不要です。

```bash
make -j2
make test
./build/shogi-lab --session
```

起動後、次のコマンドを1行ずつ入力します。1コマンドにつきJSONを1行返します。

```text
go depth 3
play 7g7f
show
go
quit
```

- `go depth 3`：現在の局面を深さ1、2、3と読み、各深さで全合法手を比較して上位5手を確定します。
- `play 7g7f`：着手を実行。保持した候補なら部分木を引き継ぎ、自動で追加探索を行います。既定の追加探索予算は200msです。
- `show`：現在の局面と、保持中の結果・候補を表示します。
- `go`：前回の完了深さから1段深いところを目標に追加探索します。初回の目標は3、最大8です。
- `quit`：終了します。

`7g7f` は初期局面の深さ3で1位になる例です。実際の入力には出力の `candidates[].move` を使えます。
`play` は候補外でも合法手なら受け付け、新しい木から探索を始めます。合法手が5手未満なら、その手数だけ保持します。

通常の流れは「`go`で読む → `play`で指す → 自動継続 → 必要に応じて`go`でさらに読む」です。
入力待ちの間に背景で無期限に探索する機能はありません。同一プロセス内で木を保持し、終了すると実行中の木は失われます。
コード・実験ログの保存と、実行中の探索木の保存は別です。

## 設定

| 起動時の設定 | 探索の違い |
|---|---|
| `--root-policy screen` | 標準。5位の境界で選別し、有望候補は同じ深さで厳密評価 |
| `--root-policy full` | 比較基準。全根候補を全窓で厳密評価 |
| `--root-policy probe` | 境界選別に、仮着手後の王手・応手数による探索順序を加える実験 |
| `--root-policy full-probe` | 全窓方式に同じ応手観測の順序を加える実験 |

応手観測は一手先の試行です。応手が少ないことだけを理由に枝を捨てません。
この設定は継続モード用で、単発の比較用探索のアルゴリズムは変えません。

```bash
# 着手直後の追加探索を500ms、保持するノード数の上限を10万にする
./build/shogi-lab --session --time-ms 500 --tree-nodes 100000

# 特定の局面と棋譜から開始する
./build/shogi-lab --session --moves '7g7f 3c3d 8h2b+ 3a2b'
```

実行中の指定例：

```text
go depth 5 time 1000 nodes 2000000
advance 7g7f
show
go depth 4 time 0
clear
quit
```

| 指定 | 意味 |
|---|---|
| `go depth N` | 最大N手先まで比較。1〜8。双方合わせた手数 |
| `go time MS` | 今回の探索全体の時間予算。0は時間制限なし |
| `go nodes N` | 今回の探索全体の訪問数上限 |
| `advance MOVE` | 木の引継ぎだけ行う。自動追加探索を止め、引継ぎ直後を検査するための操作 |
| `clear` | 盤面・実際の棋譜を保ち、探索木だけ消す |
| `--tree-nodes N` | 保持ノード上限。既定50,000、範囲32〜200,000 |

`go`の時間予算は、起動時に`--time-ms`を指定した場合はその値、指定しなかった場合は無制限です。訪問数の既定上限は200万です。
`play`による自動追加探索は、起動時の時間指定がなければ200msを使用します。
継続モードでは深さを単調に増やします。保持済みの深さより浅い比較を行う場合は、`clear`または新しいプロセスを使用してください。
時間は各ノードの入口で検査します。OSの割込みや1ノード内の処理によって、予算を少し超過する場合があります。

## 何を保持するか

1. 上位5候補それぞれの指し手・評価値・確定した深さ・読み筋。
2. その5候補に対応する探索済みの部分木。ノードIDも維持します。
3. ノードごとの探索深さ、確定値／上限／下限、読み筋。
4. 実際の棋譜と千日手・連続王手の判定に必要な履歴。

順位は全合法手を比較して決めます。5手という数は保持対象の数で、合法手を5手に限定する探索ではありません。
次の深さでは保持外の合法手も再び調べ、順位を更新します。同点はUSI文字列順で決めます。
候補の値はすべて同じ深さで計算した確定値です。下限だけ分かった手を、そのまま2位・3位として並べません。
各局面が実際に分析の根になったときに5候補を確定します。内部の全ノードで5候補の厳密順位を計算する方式ではありません。

着手直後は、前の候補の読み筋から最初の1手を除いた続きと、残りの深さを引き継ぎます。
例：3手先まで読んだ候補を指すと、新しい局面で2手先までの読みが残ります。手番側に合わせて評価を変換し、詰みの距離も1手分補正します。
新しい局面での5候補の順位は追加探索で確定します。それまでは `candidates_complete:false` とし、既存の一本の読みを5候補に見せかけません。

保持ノード上限に達した場合は、細部のキャッシュを追加せず探索を続けます。上位5候補の根と読み筋は確保し、評価結果は変えません。
別の経路から同じ盤面に到達しても木を合流させません。手順の異なる千日手履歴を混ぜないためです。

## 出力の読み方

| 項目 | 意味 |
|---|---|
| `position.candidates` | 上位5候補。`rank`, `move`, `score`, `depth`, `pv`, `node_id` |
| `position.completed_depth` | 現在の局面で保持している確定評価の深さ |
| `position.candidates_complete` | その深さで5候補の比較まで完了したか |
| `position.root_id` | 現在の根のID。着手時に候補の `node_id` がそのまま根になる |
| `position.tree_nodes` | 現在保持しているノード数 |
| `exact_hits`, `bound_hits` | 保存済みの確定値・境界値を再利用した回数 |
| `ranking_hits` | 完了済みの候補順位を再利用した回数 |
| `nodes`, `elapsed_ms` | 今回の追加探索の訪問数と時間。過去の計算は含まない |
| `capacity_misses` | メモリ上限により詳細ノードを追加できなかった回数 |
| `root_screens`, `root_exclusions` | 零窓による根候補の判定数と、5位に届かず全窓探索を省いた数 |
| `root_researches`, `root_full_searches` | 有望判定後の再探索数と、全窓で調べた根候補数 |
| `probe_nodes`, `probe_replies`, `probe_ms` | 応手観測の試行数・応手数合計・時間。全体の予算に含む |
| `trace_events`, `trace_truncated` | 記録したイベント数と記録上限による省略の有無 |
| `complete`, `stop_reason` | 目標の候補比較が完了したか、および停止理由 |

`play`の出力には、`advance`（引継ぎ直後）と`analysis`（自動追加探索後）が入ります。
`advance.previous_rank`は選ばれた元の順位、`reused_tree`は部分木を引き継いだかどうかです。
時間切れで未完了の反復は候補順位として公表しません。最後に完了した順位と、正しく計算済みの内部ノードだけを保持します。

## 検証と研究記録

```bash
make test
python3 scripts/benchmark_propagation.py
python3 scripts/audit_propagation.py
bash scripts/sanitize.sh
```

比較では、継続探索と同じ棋譜・同じ深さから新しく読み直す場合の上位5候補を照合します。
C++ではさらに各候補を全幅探索と比較し、5順位すべての引継ぎ、詰みの距離、千日手、時間切れ、容量制限、候補外の着手を検査します。
継続モードの結果は [REPORT-v0.4.md](REPORT-v0.4.md) と `results/v0.4/`。以前の自作コードは `checkpoints/` に残しています。
時間測定はビルド・テストと並行しないでください。`scripts/benchmark_session.py`はv0.3の継続実験用です。

因果ログは継続モードの`--trace PATH`で記録できます。`--trace-root-only`なら根の判断と試行だけ、
指定しなければ子の探索窓・境界の戻り・αβ打切りも記録します。`--trace-limit N`で件数を制限し、
省略時は`trace_truncated:true`を返します。出力ファイルは分析要求ごとに上書きします。
記録の費用は探索時間に入るため、速度比較では無効にしてください。

## 実装

- `src/session.cpp`：5位の境界判定、仮着手観測、因果ログ、保持する木、部分木の引継ぎ。
- `src/session_cli.cpp`：継続操作と着手後の自動再開。
- `src/session_tests.cpp`：全幅・新規探索との照合。
- `src/search.cpp`：従来の単発探索。独立した比較基準として残しています。
- `src/evaluate.cpp`：単純な駒得評価。今回も値は変更していません。

単発モードの既存コマンドも使用できます。

```bash
./build/shogi-lab --algorithm minimax --depth 3
./build/shogi-lab --iterative --depth 4
```

探索結果の再利用は**同じ経路・同じ残り深さ**に限ります。浅い結果を深い探索の確定値に流用しません。
境界値はαβの打切り条件を満たすときだけ利用します。詰みの評価はノード基準で保存し、根が変わったら距離を補正します。

駒得だけの評価の限界は残っています。静止探索はv0.5の新探索で利用できます。学習済み評価、入玉宣言、対局GUI、プロセスをまたぐ探索木の保存は未実装です。
この変更はC++研究エンジンに対するものです。

研究コードはGPL-3.0-or-later。[LICENSE](LICENSE)、[THIRD_PARTY.md](THIRD_PARTY.md)を参照してください。
