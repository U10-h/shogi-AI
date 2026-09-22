# αβ探索の先行研究21件と将棋への実装対応

調査日：2026-09-21。対象：チェス、将棋、オセロ、チェッカー、Lines of Action（LOA）、一般のゲーム木。

本資料の「実装」は論文から取り出した探索機構を現在のC++エンジンで動かしたことを指す。原著の評価関数、棋譜集合、ハードウェア、全パラメータまで再現した意味ではない。論文の効果量は今回の将棋AIの効果量として転記しない。実験結果は `REPORT-v0.5.md` に分けた。

## 調査範囲と一次資料

本文を読めた資料では関連するアルゴリズム・実験条件を確認した。要旨のみ、書誌のみ、PDFの文字抽出に問題がある資料はその範囲を明記する。同じ論文の会議稿・再録・arXiv登録年を別件として数えない。arXiv登録年を原著年と取り違えない。

| No. | 一次資料・年代・ゲーム | 確認できた範囲 | 探索の要点 | 今回の対応 |
|---|---|---|---|---|
| 1 | Knuth & Moore (1975), [An Analysis of Alpha-Beta Pruning](https://www.sciencedirect.com/science/article/pii/0004370275900193)／一般ゲーム木 | 書誌・[要旨の転載](https://charlesames.net/references/DonaldKnuth/alpha-beta.html)。本文取得不可 | 探索順序とαβの計算量・正しさを区別 | 既存minimaxを基準に、全幅AB・順序付きABを維持。正確系は評価値と選択手の最適性を照合 |
| 2 | Pearl (1980), [SCOUT: A Simple Game-Searching Algorithm with Proven Optimal Properties](https://cdn.aaai.org/AAAI/1980/AAAI80-041.pdf)／一般ゲーム木 | 本文 | 値の計算と閾値を超えるかの証明を分ける | 零窓判定、同じ深さの再探索、上位5候補の境界選別。原著SCOUTの独立コードとはせず、PVS内に実装 |
| 3 | Marsland & Campbell (1982), [Parallel Search of Strongly Ordered Game Trees](https://webdocs.cs.ualberta.ca/~tony/OldPapers/strong.pdf)／主にチェス | 本文 | 強い手順序、反復深化、記憶、主変化優先。並列化は依存する枝刈りとの兼合いがある | PVS、反復深化、killer、内部反復深化。今回は逐次探索部分を実装。分散・並列探索は対象外 |
| 4 | Reinefeld (1983), [An Improvement to the Scout Tree Search Algorithm](https://journals.sagepub.com/doi/10.3233/ICG-1983-6402)／一般ゲーム木 | 出版社の書誌。本文非公開 | NegaScout系の零窓と再探索 | 実装詳細はNo.10・18の本文で補完。`pvs` を共通実装とし、NegaScoutという別名だけの機能を増やさない |
| 5 | Schaeffer (1989), [The History Heuristic and Alpha-Beta Search Enhancements in Practice](https://webdocs.cs.ualberta.ca/~jonathan/publications/ai_publications/pami.pdf)／チェス | 本文 | cutを起こした手の履歴で内部ノードを整列。手法の組合せを評価する | `history`, `killer`、単独追加と組合せ比較。履歴更新は飽和型、静かな失敗手には減点する独自調整 |
| 6 | Anantharaman, Campbell & Hsu (1988), [Singular Extensions](https://journals.sagepub.com/doi/10.3233/ICG-1988-11402)／チェス | 出版社要旨・書誌 | 他の手と比べ突出した手を動的に深く読む | `singular`。候補と代替手を浅く比較して延長する試作。原著の完全再現ではなく、延長予算を制限 |
| 7 | Donninger (1993), [Null Move and Deep Search](https://journals.sagepub.com/doi/10.3233/ICG-1993-16304)／チェス | 出版社要旨。手順はNo.14本文でも確認 | 仮のパスでもβを超えれば探索を省く | `null`、R=2。王手中・連続null・駒の乏しい局面・相手に持駒がある局面を除外。なお誤りの可能性は残る |
| 8 | Heinz (1998; 2000再録), [Extended Futility Pruning](https://link.springer.com/chapter/10.1007/978-3-322-90178-1_4)／チェス | 出版社の詳細要旨 | 静的評価と余裕幅で残り深さ1・2の枝を省く。安全なαβカットとは異なる | `futility`、関連する `reverse-futility`, `razoring`。固定幅はこの駒得評価向けの実験値。後二者を原著の忠実実装とはしない |
| 9 | Heinz (1999), [Adaptive Null-Move Pruning](https://journals.sagepub.com/doi/10.3233/ICG-1999-22302)／チェス | 出版社要旨。No.14本文の説明でも確認 | 残り深さで削減量Rを変える | `adaptive-null`。深さ6以上R=3、その他R=2。閾値は本実装の選択 |
| 10 | Plaat, Schaeffer, Pijls & de Bruin (1994, TR94-18), [A New Paradigm for Minimax Search](https://arxiv.org/pdf/1404.1515)／チェス・オセロ・チェッカー | 本文、MT/MTDの擬似コード。arXiv登録2014とは区別 | 零窓＋記憶をドライバで反復し、上界・下界を収束させる | `mtdf`, `sss`（AB-SSS*相当のドライバ）, `dual`（AB-DUAL*相当）。有限容量・動的順序・PV復元を含むため原著の葉訪問列を完全再現するとは主張しない |
| 11 | Plaat et al. (1994, TR94-19), [Nearly Optimal Minimax Tree Search?](https://arxiv.org/pdf/1404.1518)／チェス・オセロ・チェッカー | 本文、ETC節 | 通常の最善手より先に、子の保存済み境界でcutを証明できる場合がある | `etc`。履歴と残り深さが一致する子の上界を符号反転。履歴の違う合流は許さないため、原著ほど転置を共有しない |
| 12 | Buro (1995), [ProbCut](https://skatgame.net/mburo/ps/probcut.pdf)／オセロ | [著者の書誌](https://skatgame.net/mburo/publications.html)を確認。PDF文字抽出不良。アルゴリズムは共著者本人のNo.15で補完 | 浅い値と深い値の回帰関係から窓外を確率的に推測 | `probcut`＋係数学習スクリプト。無校正の係数で起動しない。統計的推測を証明済み境界とは扱わない |
| 13 | Buro (1997研究会稿; 2000再録), [Experiments with Multi-ProbCut and a New High-Quality Evaluation Function for Othello](https://skatgame.net/mburo/ps/improve.pdf)／オセロ | 著者の書誌、PDF取得。文字抽出不良のためNo.15の説明で手順を補完 | 複数の深さ対・探索段階でProbCutを使う | `multiprobcut`。深さ対ごとに複数モデルを順次試す。ゲーム段階別モデル・原著の評価学習は未再現 |
| 14 | David-Tabibi & Netanyahu (2002), [Verified Null-Move Pruning](https://arxiv.org/pdf/0808.1125)／チェス | 本文・擬似コード。arXiv登録2008と区別 | nullのfail-high後も検証し、zugzwangなどの誤判定を減らす | `verified-null`。今回は通常の目標深さで非選択探索をやり直す厳しめの派生。原著の「深さを1減らして継続し、必要時に戻す」処理とは異なる |
| 15 | Jiang & Buro (2003), [First Experimental Results of ProbCut Applied to Chess](https://www.cs.ubc.ca/~jiang/papers/mpc_main.pdf)／チェス | [著者公開稿](https://skatgame.net/mburo/ps/chessmpc.pdf)の関連本文・回帰・深さ対・実験設計 | オセロで有効な手法をチェスへ移すには、回帰の校正・深さ対・終盤を検討する必要がある | 将棋局面で係数を新規推定、対局単位の学習／検証分割、残差と窓外率を記録。異なるゲームの効果量を流用しない |
| 16 | Björnsson & Marsland (2001), [Multi-Cut αβ-Pruning in Game-Tree Search](https://staff.ru.is/yngvi/pdf/BjornssonM01a.pdf)／チェス | 本文、multi-cut擬似コード | 上位M手の浅い探索でC本がβを超えるなら部分木を省く | `multicut`。M=6、C=3、子探索をさらに2手削減。零窓・非王手でのみ試す。複数の浅い成功でも深い証明にはならない |
| 17 | Tsuruoka, Yokoyama & Chikayama (2002), [Game-Tree Search Algorithm Based on Realization Probability](https://www.nactem.ac.uk/tsuruoka/papers/icga02.pdf)／将棋 | 本文・カテゴリ表・再探索 | 手のカテゴリ確率を経路上で掛け、低確率の枝を浅くする。α更新時には再探索 | `rps`。−log₂(p)を1000単位の深さ費用に変換。表から一部カテゴリを簡略化して採用。プロ棋譜600局からの学習や全カテゴリは再現していない |
| 18 | Winands et al. (2004-10-19著者稿), [Enhanced Forward Pruning](https://dke.maastrichtuniversity.nl/m.winands/documents/Enhanced%20forward%20pruning.pdf)／LOA | 本文、ALL/CUT/PV分類と修正版PVSの条件 | ALLノードの投機的cutは、戻り値・再探索・TT保存を一体に変えないと安全性を主張できない | 実験的multi-cutを非PVへ制限しβを返す。ただし4条件を備えたMC-Aの完全実装ではない。MC-Aの安全性は今回に継承しない |
| 19 | Winands & Björnsson (2007-07-21著者稿), [Enhanced Realization Probability Search](https://dke.maastrichtuniversity.nl/m.winands/documents/ERPS.pdf)／LOA | 本文・Fig.1の擬似コード | 早い順位の過剰削減を抑え、中間深さの再探索を挟む | `erps`。先頭5手の費用上限1ply、平均費用が1.5ply超なら中間再探索。カテゴリ確率はNo.17由来の簡略将棋モデル |
| 20 | Hoki & Muramatsu (2012), [Efficiency of Three Forward-Pruning Techniques in Shogi](https://www.sciencedirect.com/science/article/abs/pii/S1875952111000450)／将棋 | 出版社の索引・要旨。本文取得不可 | futility・null move・LMRの効率と精度を同じ将棋環境で検討する | `lmr`と三手法の単独比較。遅い静かな手のみ削減、αを超えれば元の深さで再探索。原著の定数・対局数は再現していない |
| 21 | Kishimoto & Müller (2004), [A General Solution to the Graph History Interaction Problem](https://cdn.aaai.org/AAAI/2004/AAAI04-102.pdf)／履歴依存のゲーム探索 | 本文 | 同じ盤面でも到達履歴で値が違う。盤面ハッシュだけでは不十分 | 値キャッシュは経路ID・残り深さ・延長予算で照合し、別の履歴を合流しない。論文の一般解そのものではなく保守的な回避策 |

## 実装の分類

- **固定した探索問題の答えを保つ機構**：αβ、反復深化、PVS、aspiration、履歴付き記憶、history/killer/countermove、IID、ETC、mate-distance、MTD(f)、AB-SSS*/DUAL*系。手の同点順序が変わり得るため、最善手の文字列だけで正誤判定しない。
- **探索の末端を変える機構**：静止探索、王手・取り返し・singular延長。固定深さの駒得評価とは別の探索問題になる。延長で値が変わっても直ちにバグではない。
- **見落としの可能性を持つ機構**：futility、reverse futility、razoring、null、LMR、multi-cut、ProbCut/MPC、SEEによる枝刈り、delta、RPS/ERPS。`selective`と末端方針をJSONに明示する。
- **補助機構**：将棋の持駒価値・成り・合法性を考慮した局所交換探索、countermove、静止探索のdelta。原著21件のそれぞれに一対一で新規手法があるわけではなく、共通の機構は一本化する。

### 主要な式と実装上の判断

PVSは先頭手を通常窓で読み、残りを零窓で検査し、αを改善しβ未満の手を元の窓で再探索する。aspirationは前反復の値の周りから開始し、失敗時に窓を2倍へ広げる。MTD(f)は下限・上限が一致するまで零窓を反復する。深さを変えずに判定方法を変えるため、末端評価が同じならminimax値を変えない。[Pearl](https://cdn.aaai.org/AAAI/1980/AAAI80-041.pdf)、[Plaat et al.](https://arxiv.org/pdf/1404.1515)

ProbCutでは `Vdeep ≈ a Vshallow + b + ε` とする。上方カットの浅い閾値を `ceil((β − b + zσ)/a)` とし、これを浅い探索が超えるかを調べる。今回はa>0を要求し、残差σは最低100、z=2.5を使用する。これは「99%以上正しい」という保証ではない。小標本、残差の非正規性、根で学習して内部節点へ適用する分布差、何度も検定する影響が残る。二段階の浅い判定に合格しても安全な境界証明にはならない。[Jiang & Buro](https://www.cs.ubc.ca/~jiang/papers/mpc_main.pdf)

RPSの主眼は最も深い読み筋だけを伸ばすことではなく、手の尤もらしさに探索量を配ることにある。安価な悪手が地平線の向こうへ問題を押し出すことを防ぐ再探索が必要で、ERPSではさらに早い順位の削減抑制を入れる。本実装の確率は校正された現代将棋の方策ではないので、その改善は別の検証課題になる。[RPS](https://www.nactem.ac.uk/tsuruoka/papers/icga02.pdf)、[ERPS](https://dke.maastrichtuniversity.nl/m.winands/documents/ERPS.pdf)

将棋では盤上から消えた駒が相手の持駒になる。局所交換の即時利益は、取った駒の盤上価値と生駒としての持駒価値を加える。取り返し探索では成りの選択、ピン、玉の合法性を合法手生成器に任せる。一方、同じ升の4段階の交換しか読まないので、別の升での反撃・打ち・詰みを含む真の交換評価ではない。`see-order` は順序付けだけなので正確性を保つが、`see-prune` は実験的枝刈りとなる。

履歴付きキャッシュでは、同じ現在盤面に違う着手順で到達したものを混ぜない。ハッシュを手順序のヒントに使うことと、値・上限・下限を共有することは別である。保守性の代償として、今回の `tt` は通常の盤面だけの転置表ほど合流効果を得られない。今後は「その境界がどの履歴条件に依存するか」を記録する方向が、制約伝搬の研究と接続しやすい。[Kishimoto & Müller](https://cdn.aaai.org/AAAI/2004/AAAI04-102.pdf)

## 調査から見た次の研究課題

1. **どの枝刈りが、どの局面で誤るかを先に集める。** 高速化率だけでなく、王手・持駒・取り返し・静かな受け・連続王手と誤差を対応させる。
2. **境界の根拠を保持する。** 正確な探索境界、静的な推測、浅い探索からの推測を区別し、親に戻したときの用途も追う。
3. **同じ時間内で価値のある深さが増えたかを測る。** 静止探索・延長・RPSを混ぜた名目深さは単純比較できない。強い参照エンジンによる手の評価と対局が必要。
4. **履歴の安全な共有を研究する。** 全履歴を固定する現在の方式から、反復判定に必要な履歴条件だけを保つ方式への移行は、速度と正確性の両方に関係する。
5. **棋力検証は評価関数の改善と組み合わせる。** 今回は探索手法を比較するため駒得評価を固定した。玉の危険度や位置評価を学習した場合は、枝刈り係数も再校正する。
