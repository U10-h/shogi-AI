# v0.17 文献の再検討と応用

2026-09-22。過去の `RESEARCH-v0.5.md`（21件）、v0.6、v0.13–16を読み直し、一次資料を再確認した。今回は「最初にどの手を読むか」「枝の重み」「根候補間の計算配分」「時間を増やす効果」を分けて実験する。すべての探索論文や原著アルゴリズムを実装したという意味ではない。

## 再確認した一次資料と実装への対応

| 文献・分野 | 得られる着想 | 今回の対応・原著との違い |
|---|---|---|
| [Tsuruoka, Yokoyama & Chikayama (2002), Game-Tree Search Algorithm Based on Realization Probability](https://www.nactem.ac.uk/tsuruoka/papers/icga02.pdf)／将棋 | 経路が実現する確率の積で探索範囲を変える。有望な反論は再探索する | `cost`：学習した全合法手のsoftmaxから相対的な驚きを費用へ変換。元論文のカテゴリ確率・絶対確率閾値の再現ではない |
| [Winands & Björnsson (2007会議稿), Enhanced Realization Probability Search](https://dke.maastrichtuniversity.nl/m.winands/documents/ERPS.pdf)／Lines of Action | 早い順位の過剰な削減を抑える。浅い読みがαを超えたら中間の読みを挟む | `cost`で先頭手・王手・取り返しを保護し、費用8以上の手は中間再探索後に通常費用へ戻す。LOAの性能向上率を将棋の予測値にしない |
| [Silver et al. (2016), Mastering the game of Go with deep neural networks and tree search](https://research.google/pubs/mastering-the-game-of-go-with-deep-neural-networks-and-tree-search/)／囲碁 | 方策と価値を分け、学習で探索の重点を決める | 教師自己対戦と候補順位を25,392重みの加算モデルへ蒸留。`root`は根だけ、`all`は全節点に適用。大規模CNNやAlphaGoを再現した実装ではない |
| [Kocsis & Szepesvári (2006), Bandit Based Monte-Carlo Planning](https://link.springer.com/chapter/10.1007/11871842_29)／計画・ゲーム | 良さの推定と未探索の候補を調べる利益を両立する | 根の選択に探索ボーナスを入れる。αβの異なる費用での値は独立な標本平均ではなく、UCTの信頼区間や収束保証は適用しない |
| [Danihelka et al. (2022), Policy improvement by planning with Gumbel](https://davidstarsilver.wordpress.com/wp-content/uploads/2025/04/gumbel-alphazero.pdf)／囲碁・将棋・Atari | 根候補への予算配分と、段階的に候補を減らす考え方 | `halving`は候補集合を段階的に半減し、再び全候補を戻す実験。Gumbel抽出、原著の均等シミュレーション予算、改善方策の損失関数は未実装。原著の保証を主張しない |
| [Buro (1995), ProbCut](https://journals.sagepub.com/doi/abs/10.3233/ICG-1995-18202)／オセロ | 浅い探索値と深い探索値の関係を学び、不要そうな枝を減らす | 既存 `probcut` / `multiprobcut` と学習スクリプトを再確認。既存係数はmaterial評価用で、NNUE＋無制限静止探索にそのまま転用しない。今回新たに有効化していない |
| [Buro (2002), Improving Heuristic Mini-Max Search by Supervised Learning](https://skatgame.net/mburo/ps/logaij.pdf)／オセロ | 評価・探索の判断を実データで学び、対局まで検証する | 教師一致率、探索中の値、選択手の教師評価、実対局の4段階を別々に記録する。教師一致率だけで採用しない |
| [Jiang & Buro (2003), First Experimental Results of ProbCut Applied to Chess](https://skatgame.net/mburo/ps/chessmpc.pdf)／チェス | 他ゲームへの移植では深浅関係の再推定と対局による検証が要る | オセロで有効だから将棋でも有効とは決めない。今回の計算配分法も全方式を保存し、悪化例を残す |
| [Achterberg, Koch & Martin (2004技術報告／2005論文), Branching Rules Revisited](https://opus4.kobv.de/opus4-zib/files/788/ZR-04-13.pdf)／整数計画 | 高価な強分枝の試行と、過去の改善量からの軽い予測を組み合わせる | `reliability`：候補の値の変化、首位との差、予想計算費用で再探索を配分する独自類推。MIPの双対境界・擬似費用の定義を将棋の評価値へ同一視しない |
| [Gasse et al. (2019), Exact Combinatorial Optimization with Graph Convolutional Neural Networks](https://arxiv.org/abs/1906.01629)／整数計画 | 高価な専門家の分枝選択を模倣し、軽い判断に置き換える | 教師の上位3手分布を模倣する方策学習。今回は駒と着手の疎特徴であり、変数・制約二部グラフのGCNNは実装していない |
| [Orseau et al. (2018), Single-Agent Policy Tree Search With Guarantees](https://arxiv.org/abs/1811.10928)／倉庫番 | 方策確率と探索費用を結び付ける | `cost`の経路費用を考える根拠。将棋は相手の最善応手を考えるため、単一エージェントの目標発見保証を移せない |
| [Orseau & Lelis (2021), Policy-Guided Heuristic Search with Guarantees](https://arxiv.org/abs/2103.11505)／倉庫番・タイルパズル | 方策だけでなく、状態の有望さ・目標までの見込みも使う | 根の優先度で方策と探索値を組み合わせる。ただし将棋の評価値は残距離の許容的ヒューリスティックではない。PHSそのものの実装・保証ではない |
| [Gupta et al. (2022), Lookback for Learning to Branch](https://arxiv.org/abs/2206.14987)／整数計画 | 親で惜しかった候補など、探索過程の関係を学習へ入れる | 既存TT手・counter・historyを保持。親子の学習損失やPAT正則化は今回は未実装。次のデータ設計候補として区別する |
| [Kishimoto & Müller (2004), A General Solution to the Graph History Interaction Problem](https://cdn.aaai.org/AAAI/2004/AAAI04-102.pdf)／囲碁・チェッカー | 同じ盤面でも到達履歴で結果が変わる | 値のTTは履歴パスと残費用で照合。小分け探索でも継続して使い、盤面ハッシュは手順序に限定する。原論文の一般解は未実装 |

## 固定したモデル

`policy_features` の10個の疎特徴を加算する。駒種と移動元・移動先、相対変位、取る駒、両玉との相対位置、成り、王手、移動先への双方の利き数から構成する。モデルは全合法手にlogitを出す。値の推定器や証明済み境界ではない。

教師上位3手の通常cpから `exp((score-best)/100)` を正規化して教師分布を作る。他の合法手は模倣損失の目標質量が0になるが、悪手と証明されたわけではない。正則化係数は0.01と0.1を調整集合で比較。係数0.01を選び、1024倍の整数に量子化した。

過去v0.10の学習・検証対局の各3局面ごとを利用し、新自己対戦6局を学習、2局を調整、2局を評価に固定した。局面と左右反転局面の重複をcanonicalキーで除く。新しい学習対局は損失の重みを3にした。テスト対局はモデル選択に使わない。旧データだけの同じ全手モデルも、固定係数0.01で追加学習してデータ追加の寄与を調べた。

## 費用と配分の定義

`cost`では学習確率 `p(m)=0.9 softmax(logit(m))+0.1/b`、合法手数をbとする。費用は `clamp(4+round(-2 log2(p(m)b)),2,12)`。一様確率なら4、有力手ほど小さくする。唯一の合法手は1、王手回避・王手・取り返し・TT/killer/counter手は費用3以下、先頭手は4以下に制限する。最初の根比較では辺の費用を4に揃える。単なる深さの固定や固定上位k手の除外ではない。

`roundrobin`、`puct`、`halving`、`reliability`は根ごとに256ノードから試し、未完了なら次回の枠を倍増する。完了すればその候補の費用を4増やす。全体の時間・ノード上限はすべてに共通。中断した再帰スタックは破棄するが、完了したTT項目と手順序履歴は保持する。**完全に中断位置から再開する実装ではない**。特に静止探索には値キャッシュがないため、枠が小さいと同じ部分を繰り返す費用がある。

`puct`の根優先度は `tanh(score/600)+3 p sqrt(totalAttempts)/(1+attempts)` を基本とし、周期的に全候補を再訪する。これは根だけのPUCT類推で、MCTSではない。`halving`は2周ごとに候補を半減し、1候補になった後も周期的に全候補を戻す。枠の大きさが変わるので原著Sequential Halvingの均等予算と異なる。

`reliability`は値の変化の移動平均、完了費用が少ない候補への加点、事前確率を足し、枠の平方根と首位との差で割る。信用区間や安全な上界ではなく、計算配分のヒューリスティックである。

根の全候補が少なくとも一度静止探索を完了したかを `root_covered/root_arms` で記録する。異なる費用で得た値の比較なので、全候補を同じ深さまで読んだ意味にはならない。すべての方式で選択手の教師評価と実対局を別途測る。

## 今回からの評価方針

長く戦えたことは抵抗力の改善を示す観測として集計する。対戦相手・開始局面・先後・持ち時間を揃え、開始手順を含む総手数と、実際に対戦した追加手数を分ける。時間を増やすことによる読みの変化も肯定的な仮説として試す。

同時に、500cp以上不利が継続して観測され始めた手数、評価の推移、候補差、詰みまでの長さを分ける。不利が確定した後の手数だけが増えた場合と、互角に近い時間が長くなった場合を区別できる記録にする。手数の増加を無視せず、単独で棋力向上を断定もしない。

標準モデルや探索に中飛車へ誘導する評価項は追加しない。戦型指定なしは平手初期局面から双方が自由に選ぶ。中飛車条件は後手中飛車の6手だけを開始手順として与え、以降は同じ探索器に任せる。
