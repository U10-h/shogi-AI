#!/usr/bin/env python3
import json,pathlib,shutil
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from prune_v13 import ROOT,D,M,read
s=read(D/'summary.json');t=read(D/'training.json');da=read(D/'data-audit.json');dev=read(D/'development-improved-summary.json');candidate=s['protocol']['matches']['candidate'];c=s['fixed'][candidate]
names=s['protocol']['quality']['names'];labels={'base':'Base','delta':'Delta','direct':'Direct','guarded':'Guarded','verified':'Verify 1-ply','efficient':'Cost 1%','efficient005':'Cost 0.5%','efficient0025':'Cost 0.25%'}
def pct(v):return f'{100*v:.2f}%'
def interval(v):return f"[{v['ci95'][0]:.3f}, {v['ci95'][1]:.3f}]"
def match(r):return f"{r['wins']}勝{r['losses']}敗・引分{r['draws']}・未決着{r['unresolved']}"
rows=[]
for n in ['direct','guarded','verified','efficient','efficient005','efficient0025']:
 r=dev[n];rows.append(f"| {n} | {r['nodes_excluding_audit']/dev['base']['nodes_excluding_audit']:.4f} | {r['false_prunes']:,}/{r['prunes']:,} | {r['changed_moves']} |")
fixed=[]
for n in names:
 r=s['fixed'][n];fixed.append(f"| {n} | {r['nodes_vs_base']['ratio']:.4f} | {r['time_vs_base']['ratio']:.4f} {interval(r['time_vs_base'])} | {r['root_move_changes']} | {r['root_score_changes']} |")
quality=[]
for n in names:
 vals=[s['quality'][str(b)]['variants'][n] for b in [12000,48000]]
 quality.append(f"| {n} | {vals[0]['mean_gap_cp']:.2f} | {vals[1]['mean_gap_cp']:.2f} | {vals[0]['different_moves_vs_base']} / {vals[1]['different_moves_vs_base']} |")
audits=[]
for n in names[2:]:
 r=s['audit'][n];audits.append(f"| {n} | {r['prunes']:,} | {r['false_prunes']:,} | {pct(r['false_rate'])} |")
matches=[]
for n,r in s['matches'].items():
 ci=r['paired_start_bootstrap_ci95'];matches.append(f"| {n} | {match(r)} | {r['score_rate']:.3f} [{ci[0]:.3f}, {ci[1]:.3f}] | {r['plies']:,} |")
report=f'''# 学習型枝刈りの設計・実装・実験・改善（v0.13）

実行日：2026-09-21（UTC）。αβ探索の文献を踏まえ、静止探索で「この取りが現在のαを更新するか」と「読むのに何ノードかかるか」を学習する2モデルを実装しました。予測のみ、危険な手の保護、浅い確認、コスト学習、厳しい閾値の順に改善し、固定後の新規24局面・384着手比較・576固定深さ探索・96監査探索・32対局まで完了しました。

最終の保守的な版は、固定深さのノード比 **{c['nodes_vs_base']['ratio']:.4f}**、探索時間比 **{c['time_vs_base']['ratio']:.4f}**（基準=1）。同一ノード条件では24局面すべてで基準と同じ着手でした。しかし、新規監査では **{s['audit'][candidate]['prunes']}省略中{s['audit'][candidate]['false_prunes']}件**のα更新見落としがありました。強くなったとは確認できず、標準の枝刈りは `off` のままです。

## 文献を実装へどう使ったか

[ProbCutのチェス適用研究（Jiang & Buro, 2003）](https://skatgame.net/mburo/ps/chessmpc.pdf)から、統計的な省略条件を校正し、探索短縮と対局性能を別に測る考え方を採用しました。[ERPS（Winands & Björnsson, 2007）](https://dke.maastrichtuniversity.nl/m.winands/documents/ERPS.pdf)の初期候補保護・再探索、[TreeStrap（Venessほか, 2009）](https://davidstarsilver.wordpress.com/wp-content/uploads/2025/04/bootstrapping-from-game-tree-search.pdf)の探索内部の教師と境界値の区別も参照しています。SCOUTとVerified Null-Moveを含めた5本の対応と相違は `RESEARCH-v0.13.md` にまとめました。各論文の手法をそのまま再実装したものでも、文献にある棋力向上をこちらで再現したと主張するものでもありません。

学習教師は、幅1の窓で**完了した**子探索に対する `y = 1[-child_score > alpha]`。途中停止した子は除外し、fail-soft値を正確な評価値として回帰しません。NNUEは元の固定モデルを使い、今回の追加学習で評価関数を変更していません。

## 学習と分割

| 用途 | 実使用対局数 | 根数 | 完了ラベル数 |
|---|---:|---:|---:|
| 学習 | 63 | 126 | {da['visits']['train']:,} |
| 閾値校正 | 16 | 32 | {da['visits']['calibration']:,} |
| 開発・改善比較 | 16 | 32 | {da['visits']['development']:,} |

計1,301,318ラベル。記録された親局面は560,133種類で、学習・校正・開発間の一致・左右反転一致は0件。95件の途中停止した子ラベルを除外しました。同じ対局・探索枝の訪問には相関があるため、百万件の独立試験と解釈しません。

17特徴のリスク分類の校正Brier scoreは **{t['calibration_brier']:.6f}**、学習平均だけを返す対照は **{t['constant_brier']:.6f}**。教師ラベルは実装した基準探索に対するもので、将棋の真の最善値ではありません。予測確率をそのまま未知局面の安全保証には使えません。

最終評価は別seedの24新規進行から、教師深さ6で絶対値250cp以下の非王手局面を1つずつ選択しました。採用値の範囲は−225〜223cp。過去v0.10〜v0.12の対象局面と今回の全教師ログ親局面に対し、一致・左右反転一致を除外しました。戦型の開始手順は過去実験と共有しており、未知戦型への汎化試験ではありません。探索子孫の全てが未知という意味でもありません。

## 開発で何が失敗し、何を改善したか

| 方式 | 深さ3ノード比 | 局所的見落とし / 監査省略数 | 根の着手変更 / 32 |
|---|---:|---:|---:|
{chr(10).join(rows)}

表のノード比は監査の追加ノードだけを差し引いた探索仕事量で、実時間ではありません。全32根が完了しています。

`direct` は王手・成り等の基礎保護の後、予測リスク5%以下で省略。約22%のノード減と引き換えに見落としが出ました。`guarded` では先頭2手、取り返し、玉の取り、敵玉近傍、残り深さ2以下、特徴範囲外を追加保護し、1局面で最大1手しか学習省略しません。しかし、誤った省略で探索順や再探索が変わり、ノード数が増える例もありました。

初期の深さ0確認 `staticcheck` は開発で見落とし0件、根着手・値も全一致でしたが、ノード比1.0025。元から1ノードで終わるstand-patカットを再確認しており、実質的な節約になりません。現行 `verified` は子を深さ1・親αより90raw低い閾値で確認しますが、取り返しが探索範囲の外へ押し出され、見落としと追加コストが残りました。

そこで「子探索が4ノード以上か」を学習し、コスト確率2%以上の枝に省略を絞る `efficient` を追加。校正閾値1%に加え、開発だけで0.5%、0.25%を比較しました。最終対局候補は、開発で見落とし0、根の着手・値が全一致だった0.25%版です。ノード削減は開発でも約0.65%に留まり、実時間や棋力の改善は仮定していません。モデル・閾値・実行バイナリは新規評価の前にハッシュで固定しました。

## 新規24根の固定深さ・実時間

深さ3、上限200万ノード、各方式3回、方式順序を回転。全処理終了後に直列で測定し、各根の3回の中央値を合計しました。探索内部の時間で、プロセス起動と評価モデルの読込みは含めません。数値が小さいほど少ない仕事・短い時間です。

| 方式 | ノード比 | 時間比 [95%参考区間] | 着手変更 / 24 | スコア変更 / 24 |
|---|---:|---:|---:|---:|
{chr(10).join(fixed)}

参考区間は進行を単位とする対応付きbootstrap 5,000回。測定環境・局面集合に依存し、実エンジンや長時間設定への同率の高速化を保証しません。全576探索が深さ3を完了し、3反復の探索値・PV・ノード数も一致しました。

## 同一探索量での着手品質

教師は固定YaneuraOu 6.03、深さ10。各根で全方式・両予算の着手と教師の着手をまとめて候補制限MultiPVで評価し、同じ候補集合の最上位との差を測りました。小さいほど良く、全24根がcpで比較可能でした。

| 方式 | 12,000ノード 平均差cp | 48,000ノード 平均差cp | 基準との着手相違 12k / 48k |
|---|---:|---:|---:|
{chr(10).join(quality)}

保守的な版に着手改善はありませんでした。積極的な `direct` は小予算では平均差が少し下がりましたが、48,000ノードでは悪化しました。対照の固定delta枝刈りも、この集合では基準より平均差が大きくなっています。教師の限定深さの評価は絶対的な正解ではありません。

## 新規局面で省略を監査

最初の16根、深さ3。実際に省略する直前に、その枝を元の深さで読み直してα更新を確認します。監査しても省略自体は適用し、結果で救済しません。監査付きと通常実行の根結果が一致し、ノード差が監査ノード数そのものになることを確認しました。

| 方式 | 監査した省略 | α更新の見落とし | 比率 |
|---|---:|---:|---:|
{chr(10).join(audits)}

比率は相関のある訪問の記述統計です。別方式は到達する木も省略回数も異なります。見落とし数だけ、または比率だけで優劣を決めません。局所的なα更新見落としが、そのまま根の誤着手になるわけでもありません。

保守版の失敗は、根13の静止探索中の `5f4f`（飛車による歩取り）。親α=491raw、静的評価−176raw、予測リスク0.152%に対して、元の深さでの親評価境界は630rawでした。子の確認深さ0・1・2で、全窓評価はそれぞれ630・−994・630raw。深さ1では `3c8h+` を過大評価し、次の反撃 `4f4c` まで読むと結論が変わります。これは「少し読めば確認できる」という設計の限界を示します。局面・特徴・手順を保存し、今回の固定モデルの再学習には使っていません。独立SFEN診断は祖先の反復履歴を省くので、その点も記録しています。

## 先後交換32対局

双方1手12,000ノード、同じ8開始局面を先後交換。詰み・合法手なし・反復のみで決着し、200手追加の上限到達は未決着として扱います。KIFと全着手の解析を保存しました。

| 組合せ（左側が候補） | 戦績 | 得点率 [8開始局面bootstrap参考区間] | 総着手数 |
|---|---|---:|---:|
{chr(10).join(matches)}

少数の同系統開始局面であり、Eloへ換算しません。学習した方式の一般的な棋力向上を確認する結果にはなっていません。異なる持ち時間・大規模対局での追試が必要です。

## 実装確認と保存物

- 既存テスト6,544件が通過（通常115、セッション1,274、拡張探索5,155）。
- v0.12参照バイナリと19探索でスコア・PV・ノード数・完了深さ・停止理由・fallbackが一致。モデル閾値0との19探索も一致。
- 587行について独立SFEN解析で再構成できる15特徴を照合。候補数・直前手の着手先の2特徴はこの独立再構成の対象外。全窓の子探索19件で教師の閾値判定の符号を確認。
- 全384比較探索、576固定深さ探索、96監査探索と32対局の着手・PVを別実装の将棋ルールで確認。対局KIFの読戻しも一致。
- 最初の収集で欠損した5ログを取り直し、現在の1,301,318行を全件JSON解析した。明示flushと書込失敗の検出を追加。
- `src/advanced.cpp`・`advanced.hpp`・`main.cpp`：推論、保護、確認、監査、CLI。`models/v0.13/`：2モデルとモデルカード。
- `RESEARCH-v0.13.md`：一次文献と設計の対応。`REPRODUCE-v0.13.md`：ビルド・学習・再測定。`results/v0.13/`：生データ、学習履歴、失敗例、KIF、集計、図。

## 判断と次に改善すべき点

今回達成したのは、文献に基づく学習型枝刈りの実装、誤りの監査、段階的な保護・コスト学習の改善と、未使用進行での評価です。棋力改善の確認には至っていないため、既定値を切り替えません。

次の候補は、着手後の評価変化・利き・取り返しを表す特徴と、元から1ノードで終わる枝を避けてより重い通常探索の枝を対象にする設計です。ただし確認費用を含む実時間を目的にし、改善後はさらに別の進行で評価します。今回のテスト失敗例を次の学習に使うなら、それは次版の開発データへ移し、同じテストを独立評価として再利用しません。

![比較図](results/v0.13/overview.png)
'''
(ROOT/'REPORT-v0.13.md').write_text(report)
fig,axs=plt.subplots(2,2,figsize=(16,11));fig.patch.set_facecolor('#f7f8fb')
plt.rcParams.update({'font.size':10})
x=np.arange(len(names));ticklabels=[labels[n] for n in names]
ax=axs[0,0];ax.bar(x-.18,[s['fixed'][n]['nodes_vs_base']['ratio'] for n in names],.36,label='Nodes',color='#337da3');ax.bar(x+.18,[s['fixed'][n]['time_vs_base']['ratio'] for n in names],.36,yerr=np.array([[s['fixed'][n]['time_vs_base']['ratio']-s['fixed'][n]['time_vs_base']['ci95'][0] for n in names],[s['fixed'][n]['time_vs_base']['ci95'][1]-s['fixed'][n]['time_vs_base']['ratio'] for n in names]]),capsize=3,ecolor='#6f5639',label='Time (95% root CI)',color='#d69547');ax.axhline(1,color='#333',lw=.8,ls='--');ax.set_xticks(x,ticklabels,rotation=30,ha='right');ax.set_ylabel('Ratio to baseline (lower is better)');ax.set_title('A. Depth 3: 24 roots, 3 serial repeats',loc='left');ax.legend(loc='lower left',frameon=True,facecolor='white',framealpha=.95,edgecolor='white')
ax=axs[0,1];ns=names[2:];vals=[100*s['audit'][n]['false_rate'] for n in ns];bars=ax.bar(np.arange(len(ns)),vals,color=['#b95353']*5+['#337da3']);ax.set_xticks(np.arange(len(ns)),[labels[n] for n in ns],rotation=30,ha='right');ax.set_ylim(0,max(vals)*1.35);ax.set_ylabel('Missed alpha improvements / audited cuts (%)');ax.set_title('B. New-root audit: correlated visits, not trials',loc='left')
for b,n in zip(bars,ns):r=s['audit'][n];ax.text(b.get_x()+b.get_width()/2,b.get_height()+.08,f"{r['false_prunes']}/{r['prunes']}",ha='center',fontsize=9)
ax=axs[1,0];ax.bar(x-.18,[s['quality']['12000']['variants'][n]['mean_gap_cp'] for n in names],.36,label='12k nodes',color='#337da3');ax.bar(x+.18,[s['quality']['48000']['variants'][n]['mean_gap_cp'] for n in names],.36,label='48k nodes',color='#d69547');ax.set_xticks(x,ticklabels,rotation=30,ha='right');ax.set_ylabel('Mean common-candidate gap (cp)');ax.set_title('C. Move quality: same 24 roots and candidate union',loc='left');ax.legend(frameon=False)
ax=axs[1,1];case=read(D/'counterexamples.json')[0];probes=case['full_window_probes'];ax.plot([r['child_qdepth'] for r in probes],[r['parent_score'] for r in probes],'-o',color='#337da3',lw=2);ax.axhline(case['alpha'],ls='--',color='#b95353',label='Parent alpha = 491');ax.set_xlabel('Remaining child quiescence depth');ax.set_ylabel('Parent score (raw pawn = 90)');ax.set_xticks([0,1,2,3,4,6]);ax.set_title('D. Counterexample 5f4f: depth changes the verdict',loc='left');ax.legend(frameon=False)
for ax in axs.flat:
 ax.spines[['top','right']].set_visible(False);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
fig.suptitle('Learned alpha-risk pruning | v0.13',fontsize=22,x=.055,ha='left',weight='bold');fig.text(.055,.938,'Frozen NNUE. New trajectories. Conservative candidate does not establish stronger play.',fontsize=12,color='#555');fig.tight_layout(rect=[.03,.02,.99,.915],h_pad=3,w_pad=3)
fig.savefig(D/'overview.png',dpi=150);fig.savefig(D/'overview.svg');plt.close(fig)
shutil.copy2(D/'overview.png',ROOT.parent/'shogi-v0.13-overview.png')
(ROOT.parent/'shogi-v0.13-report.md').write_text(report.replace('results/v0.13/overview.png','shogi-v0.13-overview.png'))
print('Report and figures written')
