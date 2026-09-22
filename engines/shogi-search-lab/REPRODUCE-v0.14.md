# v0.14の再現

Python 3、NumPy、SciPy、Node.js、g++ 13、GNU Makeを使用。必要な評価・教師資材は固定ハッシュで取得する。自作探索はC++17、教師は過去実験と同じYaneuraOu 6.03のWASM版。

```bash
make -j2
make test
python3 scripts/fetch_opponent.py "$PWD/../opponent"
export YANEURAOU_ASSETS="$PWD/../opponent"
```

3方式は次のように実行できる。NNUEは元重みを固定する。

```bash
# 履歴学習だけ。予測による選択的枝刈りを追加しない。
./build/shogi-lab --advanced --eval nnue \
  --eval-model "$YANEURAOU_ASSETS/yaneuraou.data" \
  --features tt,history,capture-history,killer,counter,mate-distance,qsearch \
  --depth 16 --iterative --time-ms 1000 --max-nodes 1000000000

# 事前学習した読み順を追加する場合
# 上記コマンドに以下を追加
# --policy-model models/v0.14/quiet-policy.txt --policy-scale 1

# LMRを追加する場合
# --features の末尾に ,lmr を追加
# USI対応GUIで使う場合は --advanced を --usi へ変更
```

短い起動コマンドも利用できる。

```bash
python3 scripts/run_v14.py capture --depth 16 --iterative --time-ms 1000 --max-nodes 1000000000
python3 scripts/run_v14.py selective --usi
```

`--policy-scale 0` は読み順への寄与を無効化する対照。`--policy-dump` は標準入力の1行1SFENについて、合法手、特徴ID、整数推論値を返す。`capture-history` を外し、policy-modelを指定しなければv0.13の基準探索と同じ探索結果になることを照合した。

## 学習と実験

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 scripts/train_policy_v14.py
node scripts/policy_v14.mjs dev
V14_DEV_ROUND=-history node scripts/policy_v14.mjs dev
node scripts/policy_v14.mjs devfixed
V14_DEV_ROUND=-history node scripts/policy_v14.mjs devfixed
node scripts/policy_v14.mjs quality
node scripts/policy_v14.mjs matches
node scripts/policy_v14.mjs fixed
python3 scripts/summarize_policy_v14.py
```

保存済み結果のある実験はスキップする。再実行する場合は作業用コピーで対象ディレクトリを別名へ移しておく。既存の元結果を消して上書きしない。固定時間と実時間の測定は他の探索・学習ジョブを止め、直列に実行する。

`frozen.json` はモデル、評価重み、実行バイナリのSHA-256を保持する。再ビルドでバイナリのハッシュが変わったときは、元の凍結ファイルを書き換えて同一実験と扱わない。コンパイラ・ビルドパス・デバッグ情報によってもハッシュは変わるため、配布物から再コンパイルしたバイナリは通常この照合に失敗しうる。同じ局面で追試するための具体例は以下。既知の試験集合の再測定であり、新しい独立試験とは呼ばない。

```bash
mkdir -p results/v0.14-repro
cp results/v0.14/development-selection.json results/v0.14/roots.json results/v0.14-repro/
export V14_RESULTS="$PWD/results/v0.14-repro"
node scripts/policy_v14.mjs freeze
node scripts/policy_v14.mjs quality
node scripts/policy_v14.mjs matches
node scripts/policy_v14.mjs fixed
python3 scripts/summarize_policy_v14.py
unset V14_RESULTS
```

新規局面を再生成する場合は、作業用コピーで新しいプロトコルを作り、`collect` → `prepare_policy_roots_v14.py` → `quality` の順に実行する。元実験のseedは2026092114。24進行を生成し、候補を評価する前に、非王手・教師深さ6で絶対値250cp以下・16手以降・offset24に近い順という固定条件で1進行1根を選んだ。条件を満たさない進行は後から条件を緩めず除外する。

## 検証

`verify_policy_v14.mjs` はtsshogiによる独立の特徴再計算と整数推論の照合、および変更前バイナリ・新しい基準・scale0の探索一致を確認する。変更前バイナリの比較には、`checkpoints/v0.13/src/` の3ソースを元に別作業コピーでビルドして `build/shogi-lab-v0.13` として用意する。

全比較で返された着手と読み筋はtsshogiで合法性を検査し、対局はC++とtsshogi双方で終端・反復を照合した。KIF出力は読み戻してUSI列の一致を確認する。生結果、棋譜、モデル、CSV、ソース差分をまとめて残す。
