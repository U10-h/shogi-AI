# v0.20 — 最近の将棋AI研究・実装の調査（2026-09-22）

査読論文と開発者の一次資料を区別する。「最新」は今回本文を確認できた範囲。既存研究の網羅や、個々の探索技法が2026年に発明されたことは主張しない。

| 公開・更新日 | 一次資料 | 本研究に関係する内容 | 今回の扱い |
|---|---|---|---|
| 2026-08-27 | [やねうら王：BookMiner利用の近況](https://yaneuraou.yaneu.com/2026/08/27/fujii-sota-follows-ai-223-move-opening-book/) | 大規模な定跡掘りの利用例 | 調査のみ。オンライン探索能力と定跡の効果を混同しない |
| 2026-08-11 | [やねうら王：Finny tables導入](https://yaneuraou.yaneu.com/2026/08/11/finny-tables-implemented-in-yaneuraou/) | 玉位置ごとのNNUE accumulator cacheにより全計算を減らす。手法自体は以前から存在 | 現モデルはK+Pなのでそのまま移植できない。完全一致する静的評価キャッシュと差分計算の融合を独自に比較 |
| 2026-06-18 | [やねうら王：BookMiner公開](https://yaneuraou.yaneu.com/2026/06/18/shogi-bookminer/) | 大規模定跡生成を支援する公開スクリプト | 調査のみ。定跡は全評価・対局で無効 |
| 2026-05-21 v2、ICML 2026採択 | [Ota et al., Revisiting Regularized Policy Optimization for Stable and Efficient Reinforcement Learning in Two-Player Games](https://arxiv.org/abs/2602.10894v2)、[本文](https://arxiv.org/html/2602.10894v2) | reverse KLとentropy正則化を併用した方策更新KLENT。どうぶつしょうぎ等で学習効率を評価 | 本将棋の実証ではない。現行の教師方策だけを置き換えて再現とは呼べないため、自己対戦学習基盤を要する次段階として保留 |
| 2026-05-07 | [WCSC36振り返り・水匠11](https://yaneuraou.yaneu.com/2026/05/07/wcsc36-petashock-suisho11/) | 勝率変換のスケール、量子化・飽和、教師からの蒸留が関係 | 出力評価を75%/125%にした感度試験。学習時のスケール最適化・蒸留の再現ではない |
| 2026-01-31 | [Stockfish 18公式発表](https://stockfishchess.org/blog/2026/stockfish-18/) | SFNNv10、脅威特徴、探索・correction history等の更新 | チェス由来。現行ソースのcorrection history / continuation history / SEEを将棋の持駒と既存探索に合わせて小規模実装 |
| 2025-12-29 | [やねうら王：2025年の将棋AI開発](https://yaneuraou.yaneu.com/2025/12/29/shogi-ai-2025/) | 強い教師からの知識蒸留、既存局面の再ラベルなど | 調査のみ。最新DL教師・大規模訓練を用意していないため、古いNNUE教師で同等の成果を主張しない |
| 2025-12-25 | [SPSA関連の開発者報告](https://yaneuraou.yaneu.com/2025/12/25/a-brief-story-related-to-spsa/) | 対戦相手と測定信号の問題 | 小規模チューニングの結果を強さの証明にしない設計に反映 |
| 2025-12-01 | [NNUEによる学習データ生成](https://yaneuraou.yaneu.com/2025/12/01/nnue-based-training-data-generation/) | NNUEを学習用教師データ生成に利用する議論 | 次段階の学習基盤の候補 |
| 2025-07-31 | [SPSAの導入解説](https://yaneuraou.yaneu.com/2025/07/31/introduction-to-the-spsa-algorithm/) | 2方向の同時摂動でパラメータ勾配を推定 | SEE許容損失と評価スケールの2変数を、40,000 / 200,000ノードの2試行で実際に調整。目的は教師cpであり対局勝率ではない |

## 実装を直接確認したソース

- [YaneuraOu search.cpp（固定コミット）](https://github.com/yaneurao/YaneuraOu/blob/c1b80eaa09fe13d5f12b1599d1ae4d53c224de30/source/engine/yaneuraou-engine/yaneuraou-search.cpp)：pawn/minor/non-pawn/continuationの複数補正、静止探索のSEE条件、continuation historyなど。今回の補正は歩配置＋両者の全持駒をハッシュする簡易版で、重みやテーブル構成は同一ではない。
- [Stockfish 18 search.cpp](https://github.com/official-stockfish/Stockfish/blob/sf_18/src/search.cpp)：補正の適用と更新条件、静止探索のSEE等。チェス専用の値を、そのまま本実装の歩=90単位へコピーしていない。

## 今回実装・実行した改善候補

1. **静的評価キャッシュ**：NNUE出力だけを再利用。盤面81マス・持駒・手番の完全比較で一致を確認する。千日手や探索値をキャッシュしない。Finny tablesの直接移植ではない。
2. **差分更新の融合**：複数の重み列の加減算をAVX2レジスタ上でまとめる。高速化を仮定せず、単独・キャッシュ併用を測定。
3. **Continuation history**：直前と現在の静かな手の組を学習し、手順序と探索努力配分に使う。
4. **Correction history**：静かな探索結果と静的評価の誤差をオンラインで更新。最大補正180（歩=90）。変化する葉評価と古い探索値が混ざらないよう値TTを無効化し、手順序ヒントだけを残す。補正量0の対照実験も行う。
5. **静止探索SEE枝刈り**：許容損失0/90/180で比較。王手回避・王手・成り・駒打ちは対象外。駒交換の損得は局面評価の厳密な上界ではないため、反実仮想の非枝刈り探索による診断を追加。
6. **評価スケール**：75%/125%。詰み・千日手の値には掛けない。
7. **SPSA**：同じ局面の±摂動を教師が共通候補集合で再評価し、2変数を16回更新。最良反復を事後選択せず最後の値を使う。最初の計算量で信号が得られず、5倍で一度追加した履歴も保存。

## 適用範囲

大きなネットワークへの変更、最新DL教師の蒸留、KLENTの自己対戦学習、BookMinerの大規模定跡生成は実施していない。今回の対象は既存のK+P NNUEと適応探索の上に載せられる改善。探索結果・勝率を元研究の報告値と同等とはみなさない。評価用エンジンは手元のYaneuraOu 6.03 WASMであり、2026年の最新強豪ではない。
