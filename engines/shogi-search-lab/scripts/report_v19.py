#!/usr/bin/env python3
import json,os
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V19_RESULTS',R/'results/v0.19'))
read=lambda name:json.loads((D/name).read_text())
s=read('summary.json');m=read('implementation-metrics.json');legal=read('legal-audit.json');sel=read('selection.json')
q={(x['variant'],x['ms']):x for x in s['quality']};dev={x['variant']:x for x in m['development']}
speed=(1-m['exactOptimization']['ratioOfMedianSums'])*100
fmt=lambda x:'—' if x is None else str(x)
text=f'''# v0.19：保存対象の見直しと、探索統計の軽量化

**探索結果を変えない統計処理の軽量化を標準へ反映した。同一ノード比較で新ビルドの時間中央値の合計は旧版より{speed:.1f}%短かった。重い読みだけの保存と入口だけの保存も実装したが、新しい12局面では入口保存版と旧版の着手評価は全36組で同等。棋力向上を確認したとは扱わず、保存の新方式は任意の実験設定として残す。**

2026-09-22。起点はv0.18コミット `00e7c5de859fcbf8af46446ec96e8eef3af8d4d7`。実装は `work/v0.19-cost-aware-cache`、ソース保存コミット `6260f708db6a0e7ce40d059cbded47432b82945b`。mainへのマージは行っていない。

## 考察から実装へ

前回は読みの保存領域100,000件が早期に埋まり、照合と保存の負担が残った。今回の開発20局面では、従来設定の保存操作{dev['legacy']['stores']:,}回のうち{dev['legacy']['oneNodeStores']:,}回（{dev['legacy']['oneNodeStores']/dev['legacy']['stores']*100:.1f}%）が1ノードで終わる読みだった。これは保存時の操作数で、固有節点の割合ではない。

そこで、次の3点を実装した。

1. **保存の最低費用**：`--qcache-min-nodes 8` / `32`。完了した読みの実訪問ノード数で保存を選ぶ。候補手の打ち切り条件には使わない。
2. **入口だけの保存**：`--qcache-scope entry`。静止探索内部の経路登録・照合を省く。履歴を含む入口IDでのみ値を再利用する。
3. **統計処理の軽量化**：手数ごとの戻り回数を配列で集計し、最後に従来のJSONへ変換する。毎ノードの文字列生成とマップ検索を減らし、出力の意味と値を保つ。

NNUEと根の方策モデルは固定。深さ・上位k手の固定制限は加えず、上界・下界・詰み距離・千日手の扱いを維持した。保存の既定設定 `all`・閾値1も互換性のため残した。qcache自体は標準では有効にしない。

## 開発比較：容量削減と棋力を分ける

v0.18で使用済みの20局面・各500ms・6方式。詰み評価の1局面を除く19局面で教師候補差を比較した。これは開発集合であり新規評価ではない。

| 方式 | 平均保存件数 | 平均処理ノード | 平均候補差cp |
|---|---:|---:|---:|
'''
labels={'root':'保存なし・新ビルド','legacy':'従来の全節点保存','all8':'8ノード以上を保存','all32':'32ノード以上を保存','entry1':'入口だけ保存','entry8':'入口・8ノード以上'}
for v in labels:
 a=dev[v];text+=f"| {labels[v]} | {a['meanEntries']:,.0f} | {a['meanNodes']:,.0f} | {sel['totals'][v]['meanGap']:.2f} |\n"
text+='''
閾値によって保存件数は大幅に減ったが、全節点方式では内部の経路登録費用が残った。入口方式はその登録を省く。処理ノード数はキャッシュで省けた読みを数えないため、その大小だけで速さ・強さを比べない。

事前規則は平均候補差、同点なら完了反復数、さらに同点なら規定順。入口だけ保存するentry1を追試へ選んだ。ただし保存なしとの差は、既知の根 `prior-1-56` の1局面に由来する。入口版は2反復の `1b2b`、保存なしは3反復の `1b2a` で、教師差341cpだった。ただし教師評価はそれぞれ+6,104cpと+5,763cpで、どちらも大幅なプラスの局面である。この差を対局の勝敗改善とみなさない。**この開発時の優位は、浅い段階の手を維持した結果であり、より深く読めた証拠ではない。**

## 新しい局面での追試

別seedの4教師進行から12局面を採り、旧版標準と入口保存版を1/3/5秒で比較した。全72探索が初回反復を完了。各条件1回。全方式・予算の選択手と教師自身の手を共通集合にし、固定教師の深さ12で採点した。値は候補集合内の差であり、全合法手に対する真の損失ではない。

| 自作の時間 | v0.18標準 | v0.19入口保存 | 対応比較 |
|---|---:|---:|---|
'''
for t in [1000,3000,5000]:
 a,b=q['base',t],q['entry1',t];pa=next(x for x in s['pairedQuality'] if x['ms']==t)
 text+=f"| {t//1000}秒 | {a['meanGap']:.2f}cp | {b['meanGap']:.2f}cp | {pa['better']}改善・{pa['equal']}同等・{pa['worse']}悪化 |\n"
text+='''
1秒から3秒では両方式とも平均候補差が改善し、3秒から5秒は同等だった。新しい局面で開発時の優位は再現しなかった。入口保存も3秒以降は12局面すべてで100,000件へ達しており、入口だけに絞れば容量問題が解決するわけではない。

4進行内の局面は相関し、過去の学習との完全な非重複は保証しない。Elo・有意な棋力差・安定した一般化区間は算出しない。

## 対局

初期局面から戦型指定・定跡なしで8局。先後を交換し、自作3秒/5秒、固定やねうら王NNUE 6.03 WASMは2秒。最新ネイティブ版との比較ではない。2方式は同じ条件・同じCPUコアで順に指し、組ごとに順序を逆転させた。

| 方式 | 自作の時間 | 先後 | 終局手数 | 結果 | 500cp不利の継続開始 |
|---|---:|---|---:|---|---:|
'''
for g in s['games']:
 text+=f"| {'v0.18標準' if g['variant']=='base' else '入口保存'} | {g['ourMs']//1000}秒 | {'先手' if g['side']=='black' else '後手'} | {g['totalPlies']} | {dict(win='勝ち',loss='負け',draw='引分',unresolved='未決着')[g['outcome']]} | {fmt(g['firstSustained500Ply'])} |\n"
counts={k:sum(g['outcome']==k for g in s['games']) for k in ['win','loss','draw','unresolved']}
text+=f"\n結果は{counts['win']}勝・{counts['loss']}敗・{counts['draw']}引分・{counts['unresolved']}未決着。各方式・時間は先後1局ずつであり、勝率や持ち時間の優劣を一般化しない。"
text+='''500cp欄は相手の確定cp評価で500以上が3回連続観測された最初の時点で、敗着の確定ではない。手数が伸びた場合も、不利になった後に長引いたかを区別する。

'''
for t in [3000,5000]:
 for side in ['black','white']:
  gs={g['variant']:g for g in s['games'] if g['ourMs']==t and g['side']==side};a,b=gs['base'],gs['entry1']
  text+=f"- {t//1000}秒・{'先手' if side=='black' else '後手'}：旧版{a['totalPlies']}手→入口保存{b['totalPlies']}手。不利継続開始は{fmt(a['firstSustained500Ply'])}→{fmt(b['firstSustained500Ply'])}手。\n"
text+='''
## 検証と残った問題

- セルフテスト **7,058チェック通過**。履歴依存の千日手・連続王手、詰み、容量1、途中停止、保存閾値、合法PVを含む。
- 保存無効の8局面×3回・20万ノードで、旧版と値・PV・ノード数・停止理由・全統計が一致。追加の8局面×6方式では、旧設定の互換性と完了した最初の静止探索の値を比較した。上位の全反復の値が不変という主張ではない。
'''
text+=f"- 時間中央値の合計比は{m['exactOptimization']['ratioOfMedianSums']:.4f}、新ビルドが約{speed:.1f}%短い。ただし8局面中2局面は遅く、単一環境・各3回の測定。これはビルド全体の差で、変更した命令ごとの因果分離ではない。\n"
text+=f"- 独立ルール実装で{legal['gameCount']}局・{legal['gameMoves']}着手、{legal['searches']}探索出力、PV延べ{legal['pvMoves']}手、教師候補{legal['teacherPVs']}本、生成進行{legal['trajectoryMoves']}手を検査。KIFの読み戻しと終局状態も一致。\n"
text+='- 既知の難しい終盤6局面・1秒では、'+ '、'.join(f"{labels[r['variant']]} {r['completed']}/6完了" for r in s['fallback'])+'。大半の初回比較未完了は残った。\n'
if (D/'runner-recovery.json').exists():
 recovery=read('runner-recovery.json')
 text+='- 実行環境の切断後、'+ '、'.join(f"{g['id']}の{g['plies']}手" for g in recovery['games'])+'から再開した。旧プロセスの停止を確認し、毎手リセットという条件を維持。再開位置・時刻を保存した。\n'
text+='''
**採用するのは、互換性を確認した統計処理の軽量化。入口・最低費用による保存は実験機能として残す。** 新しい保存方式だけで強くなったとは結論しない。次に優先すべき課題は、反復を深めた際に良い手を失う局面での評価・反論の追跡と、初回比較を完了できない終盤の処理である。

![比較結果](results/v0.19/overview.png)

[観戦ファイル](v0.19-review.html)に8局の盤面と読み筋を収録した。HTMLのJavaScript構文・収録データは検査済みだが、ブラウザーでの画面操作確認は未実施。[設計](RESEARCH-v0.19.md)、[再現手順](REPRODUCE-v0.19.md)、`results/v0.19/` にプロトコル、固定ハッシュ、原データ、CSV、棋譜、監査を保存した。
'''
(R/'REPORT-v0.19.md').write_text(text)
