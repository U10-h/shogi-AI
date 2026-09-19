# 日本語の先生の調整記録

重みの再学習ではなく、既存の端末内 Qwen2.5 Instruct 0.5B / 1.5B に渡す指示、関連語の選択、読み筋の根拠、出力検証を調整する。外部の有料推論 API は追加しない。

## 第1回 — 言葉の意味と指導の組み立て

攻め・受け・手渡しを中心に15語の短い独自説明を用意。質問に関係する最大2語を選び、用語の定義とこの局面での証拠を分離した。相手の応手だけで話を終えず、7手先の結果とつなぐ指示に修正。検証: `node --test tests/tutor-tuning.test.mjs`。

## 参照先（2026-09-19に確認）

- [日本将棋連盟「王手と詰み」](https://www.shogi.or.jp/knowledge/shogi/04.php): 王手・詰み・合駒の区別。
- [将棋タウン 用語集・た行](https://www.shogitown.com/school/dictionary/word/dic-ta.html): 手待ち、手抜き、突き捨て。手渡しの説明は「相手に手を渡す」という説明を参考にした本アプリの指導上の整理。手待ちと完全な同義とは扱わない。
- [同・さ行](https://www.shogitown.com/school/dictionary/word/dic-sa.html): 捌き、指し過ぎなど。
- [同・あ行](https://www.shogitown.com/school/dictionary/word/dic-a.html): 一手すき・詰めろ、移動合い。
- [同・は行](https://www.shogitown.com/school/dictionary/word/dic-ha.html): 必死（本アプリでは必至とも表記）。

Web検索も実施したが無関係な結果が多かったため、サイト内の用語集を直接辿って確認。将棋タウンは Shift_JIS のため取得時に CP932 として復号。説明の転載や図・棋譜の取り込みは行わず、定義を短く自分の言葉で整理した。攻め・受けの記述はこれらの基礎概念に基づく指導用の要約。

## 実行上の限界

この開発環境には WebGPU 対応の端末内対話実行環境がない。自動検証はプロンプト、根拠選択、出力検証、規則による先生の応答を対象とする。Qwen の実際の生成品質や POCO F6 Pro 上での速度を測定したとは主張しない。
