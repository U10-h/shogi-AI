"""Build a concise Japanese research report from complete saved measurements."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=Path(__file__).resolve().parents[1];D=R/'results/v0.12'
def read(p):return json.loads(p.read_text())
s=read(D/'summary.json');t=read(D/'training.json');st=read(D/'static-test.json');ls=read(D/'leaf-summary.json');edges=read(D/'leaf-edge-validation.json');checks=read(D/'implementation-checks.json')
assert s['matchCount']==64 and s['qualityRows']==22 and s['searches']==220
names=['base','pair','affine','anchored50','tempo40'];jp={'base':'元評価','pair':'候補差学習','affine':'倍率補正対照','anchored50':'前回学習版','tempo40':'+40cp対照'}
static_table='\n'.join(f"| {jp.get(n,'差を常に0とする診断')} | {v['gapMaeCp']:.2f} | {100*v['rankAgreement20cp']:.2f}% |" for n,v in st['variants'].items())
qtable='\n'.join('| '+str(n)+' | '+' | '.join(f"{s['quality'][str(n)+'-allCp']['variants'][name]['gap']['mean']:.2f}" for name in names)+' |' for n in [12000,48000])
mtable=[]
for key,v in s['matches'].items():
    n,a,b=key.split('-');ci=v['resolvedScore']['ci95'];mtable.append(f"| {int(n):,} | 学習版 対 {jp[b]} | {v['wins']}勝{v['losses']}敗{v['draws']}引分 | {v['unresolved']} | {100*v['resolvedScore']['mean']:.1f}% [{100*ci[0]:.1f}, {100*ci[1]:.1f}] |")
qdelta=[]
for n in [12000,48000]:
    for comp in ['pair-base','pair-affine']:
        v=s['quality'][str(n)+'-allCp']['comparisons'][comp];d=v['deltaGap'];ci=d['ci95'];qdelta.append(f"| {n:,} | 学習版 − {jp[comp.split('-')[1]]} | {d['mean']:+.2f} [{ci[0]:+.2f}, {ci[1]:+.2f}] | {v['improved']} / {v['equal']} / {v['worse']} |")
text=f'''# 将棋AI 継続実験 v0.12：候補の順位と探索中の評価分布

実行日：2026-09-21（UTC）。v0.11を基に、候補間の評価差を学習するモデル、単純な倍率補正対照、静止探索の観測機能を実装しました。新規24進行・3,676候補ペア、22局面×5モデル×2ノード条件、64対局を測定しました。

**評価差の予測誤差は減りましたが、順位・棋力の改善は確認できません。新モデルは実験候補にとどめ、標準評価を置き換えません。** 今回の収穫は、誤差の減少をそのまま棋力向上と判断できないことと、学習局面で平均補正を0にしても探索の葉では−103.70cpにずれることを、比較実験と探索記録で確かめた点です。

## 実装と実験設計

- 既存のKP256 NNUEの特徴変換・最初の隠れ層を固定し、32→32→1の後段を学習。新規にNNUE全体を学習したわけではありません。
- v0.10の128学習進行から31,904ペア（11,934根）、32検証進行から7,920ペア（2,924根）。同じ教師探索の兄弟候補に限定し、非王手・通常cp局面を使用。対局単位の分割と左右反転を含む分割間重複排除を引き継ぎました。
- 教師の候補差と元評価の候補差の残差を±324 raw（360cp）に制限し、反映率0.5 / 1.0を比較。Huber損失・元重みと元評価への正則化・整数化を考慮した学習を実装。各根のペアの重みの合計を1にしています。
- 出力バイアスは学習せず、書出し時に**学習集合だけ**で元評価との平均差をほぼ0に調整。検証誤差によりpair100の20エポック目を選びました。旧テスト集合は選択に使っていません。
- 検証結果を見て、学習モデルを近似する倍率・定数を学習集合だけで推定した対照を追加。倍率は約0.90465。整数重みへの丸めを含むため、厳密な実数の一様倍率ではありません。
- 順位のロジスティック損失と分布幅の投影も試しましたが、元評価の順位正解率を上回るチェックポイントは得られませんでした。後半は投影とint8飽和によって数値的に不安定になりました。この試行は不採用とし、分布の崩れを検知して停止する処理を追加しました。初期の失敗コード・全ログと、停止処理の確認結果を保持しています。
- 対照追加・順位試行の不採用は、新規集合でのモデル比較結果を開く前に確定。`protocol-v1.json`と改訂理由を残し、その後はモデルを変更していません。

新規24進行は新しい乱数種で生成しましたが、開始手順の系統は前回と共有しています。未知戦型への汎化試験ではありません。各進行から、16手目以降・非王手・教師深さ6の最上位評価の絶対値250cp以下・offset24に最も近い未出局面を1つ採用しました。2進行は条件を満たさず、22局面となりました。全v0.10ラベルとv0.11収集根の一致・左右反転一致を除外しています。

採用根の深さ6評価は−211〜+201cpでした。ただし深さ10の制限なし教師探索では絶対値中央値180.5cp、最大1,010cpであり、厳密な均衡局面ではありません。対局には先頭8根を事前指定して先後交換を行いました。

## 1. 評価差の誤差が下がっても、順位改善とは限らない

選択に使わなかった新規24進行の1,290根・3,676兄弟ペア・3,770子局面で測定しました。表の誤差は各根を等重みとし、順位正解率では教師差20cp未満を除外しています。予測同点は順位一致に数えません。

| 評価モデル | 候補差MAE（cp、小さいほどよい） | 順位正解率 |
|---|---:|---:|
{static_table}

学習版の誤差は586.97→555.11cpに改善しました。しかし、単純な倍率補正でも564.04cpまで下がります。さらに、全候補の差を0と予測する診断値は476.49cpで、学習版より小さい誤差になります。この診断は候補を区別できず、対局モデルには使っていません。**候補差MAEだけを選択基準にすると、評価値を圧縮する方向を過大評価し得ます。**

学習版の順位正解率は60.28→60.48%で、上昇は0.21ポイントです。進行ごとを等重みとした平均改善は0.18ポイント、進行単位5,000回ブートストラップの95%区間は−0.24〜+0.55ポイントでした。倍率対照との差も区間が0を含みます。表の各根等重みの点推定と、各進行等重みの区間は重みが異なります。

静的誤差の減少には定数・倍率だけでは説明できない部分もあります。しかし、それが有効な候補選択に結びついたとは、この結果からは言えません。

## 2. 実際の探索で選ぶ手

同じ22局面を12,000・48,000ノードで比較しました。各局面について、5モデル×両ノード条件の着手と教師自身の着手を一つにまとめ、教師の深さ10・共通候補集合で採点しています。「候補差」は、その集合内の最高評価と選択手との差です。全合法手に対する厳密な最善手損失ではありません。全22局面が通常cp条件を満たしました。

| ノード/手 | 元評価 | 候補差学習 | 倍率補正対照 | 前回学習版 | +40cp対照 |
|---:|---:|---:|---:|---:|---:|
{qtable}

単位は平均候補差cp、小さいほどよい指標です。今回は根と採点集合を両予算で共通にしているため、同じ根について探索予算の差も比較できます。

| ノード | 比較 | 平均差cp [95%区間] | 改善 / 同等 / 悪化 |
|---:|---|---:|---:|
{chr(10).join(qdelta)}

負の差は学習版がよいことを表します。区間は進行単位の5,000回ブートストラップです。48,000ノードでの元評価に対する改善も、着手品質が変わったのは2局面で、残る20局面は同等でした。全体の優位性は確認できません。前回学習版と+40cp対照は、今回の両予算・全22局面で選択手が一致しました。

## 3. 64対局

| ノード/手 | 比較 | 学習版の成績 | 未決着 | 決着・引分の得点率 [参考95%区間] |
|---:|---|---|---:|---:|
{chr(10).join(mtable)}

同じ8開始局面の先後ペアをまとめて再標本化しました。64局を独立な64標本とは見なせません。最大200手、詰み・合法手なし・千日手・連続王手の千日手でのみ判定し、手数上限は未決着として扱っています。全対局を分母にした得点率の上下限も保存しています。

対局相手は自作探索に別の評価を載せたものです。本家やねうら王は固定版NNUE KP256 6.03を教師として使用しています。今回の結果を本家に対する勝率やEloに換算しません。全着手ごとに探索状態を作り直し、固定ノード条件で並列実行しました。1手3秒の固定時間試験ではありません。

## 4. 大きな悪化の原因：評価補正が完了深さを変える

12,000ノードで最も悪化した根はgame4・37手目でした（結果確認後の診断であり、独立した追試ではありません）。学習版は`4e3g+`を選び、元評価の`6f5g+`より教師評価が1,490cp低くなりました。

| 条件 | 元評価 | 学習版 |
|---|---|---|
| 深さ2を完了 | `4e3g+`、1,554ノード | `4e3g+`、1,819ノード |
| 深さ3を完了 | `6f5g+`、7,220ノード | `6f5g+`、8,561ノード |
| 反復深化・12,000ノード | 深さ3、`6f5g+` | 深さ2、`4e3g+` |
| 学習版だけ12,500ノード | — | 深さ3、`6f5g+` |

固定深さの測定は反復深化なしです。反復深化では前の深さの探索にもノードを使い、学習版の深さ1〜3の合計は12,475ノードでした。あと475ノード足りず、浅い結果を採用していました。倍率・前回学習版・+40cp対照も、固定深さ2では前者、深さ3では後者を選びます。この局面の悪化は、同じ深さでの評価順位の違いよりも、探索が膨らんで深さ3を完了できなかったことに整合します。これを一般局面すべての原因とは断定しません。

## 5. 探索の葉を実際に観測した

`--leaf-trace PATH`を追加しました。静止探索について、節点ID・親の静止探索節点ID・根の候補手・反復深さ・ply・静止探索残り深さ・α/β・SFEN・王手状態・静的評価・戻り値・終了理由をJSONLに記録します。王手中の静的評価はnullとし、途中で打ち切られた節点には完了イベントを作りません。通常探索から静止探索へ入る点の親IDは0です。通常探索全体の親子グラフを記録する機能ではありません。

8根×4モデルで{edges['nodes']:,}静止探索節点、{edges['edges']:,}親子辺を取得しました。辺・王手状態・戻り読み筋は独立したtsshogiで照合済みです。

元評価が実際に訪れた**同一の**非王手84,137評価訪問（58,179 SFEN）を固定し、各モデルの補正を計算しました。重複訪問を含む訪問数で重み付けしており、84,137個の独立局面という意味ではありません。

| モデル | 学習集合上の平均補正 | 元評価の探索葉での平均補正 | 葉での補正RMS |
|---|---:|---:|---:|
| 候補差学習 | −0.03cp | −103.70cp | 276.56cp |
| 倍率補正対照 | 約0cp | −68.30cp | 237.09cp |
| 前回学習版 | 今回は再調整せず | +46.40cp | 49.71cp |
| +40cp対照 | +40cp | +39.99cp | 39.99cp |

学習に使った教師進行の子局面と、自作探索で訪れる局面では分布が異なります。平均を学習集合上でそろえるだけでは、探索葉での補正までそろいません。ただし、この平均のずれだけで評価の正誤を判定したわけではありません。

元の探索窓を固定した82,520訪問で静的評価だけを差し替えると、学習版では1,640訪問がstand-patのβカット条件を外れ、39訪問が新たに条件を満たしました。倍率対照では324 / 42訪問です。実際の別モデル探索では窓や訪問先も変わるため、これは**固定した窓に対する感度診断**であり、そのまま実際のカット減少数とは数えません。

## 検証・再現性

- 基礎115、セッション1,274、探索5,155の計6,544チェック成功。
- 22根×2モデル＝44件でv0.11バイナリとのスコア・PV・ノード数・完了深さ・停止理由・統計・fallbackが一致。
- 32件のトレースON/OFFで検索結果と探索統計が一致。記録上限5件の場合も探索は同一で、記録できなかった件数を明示。
- 根22件＋葉128件×5モデル＝750件で独立Python特徴計算・整数推論とC++推論が一致。葉58,179 SFENの整数出力も一致。
- ペア差損失・順位損失の勾配を有限差分で検証。投影後の不安定化を検知する停止処理は隔離した作業先で再実行し、元評価を保持することを確認。
- 64対局の着手とPVを別実装で確認し、KIFの書出し・再読込みを照合。モデル・バイナリ・主要ソースのハッシュ、全棋譜、設定、JSON/CSV、失敗ログを保存。

## 次の実験に向けた方針

1. **候補差MAE単独でモデルを選ばない。** 順位一致、実際の選択手の教師損失、対局、ノード予算ごとの完了深さを併記します。定数補正・倍率補正は引き続き対照に置きます。
2. **学習用の進行から自作探索の葉を集め、教師で再採点する。** 今回観察したテスト葉をそのまま次の独立テストには再利用せず、学習・検証・最終評価の進行を再び分離します。王手・深さ上限・βカットなどの終了理由ごとに偏りを確認します。
3. **葉の補正→β条件の変化→探索量→完了深さ→着手を追う。** 制約伝搬の観測と同様に、影響の経路を記録する方向です。ただし評価値は推定なので、枝刈りの正しさを論理的に証明したことにはなりません。
4. **整数表現での出力分布を制御する。** 浮動小数点上の分布をそろえてからint8に切り詰めるだけでは崩れるため、書出し後の分布・飽和率を採用条件にします。
5. **新しい開始系統・より深い均衡判定・固定時間条件へ進む。** 現行の22根と24進行は今後は既知データとして扱います。今回の結果だけで評価重みや標準探索設定は昇格させません。

再現手順は`REPRODUCE-v0.12.md`、全結果は`results/v0.12/`、学習済み後段は`models/v0.12/`にあります。
'''
(R/'REPORT-v0.12.md').write_text(text)

plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,axs=plt.subplots(2,2,figsize=(12,8));fig.subplots_adjust(wspace=.32,hspace=.48,top=.90,bottom=.10)
colors=['#64748b','#cc6633','#348c96','#8d73b0','#3d8d6e'];labels=['Base','Pair learned','Affine control','Previous learned','Tempo +40']
x=np.arange(5);width=.37
for j,n in enumerate([12000,48000]):
    vals=[s['quality'][str(n)+'-allCp']['variants'][k]['gap']['mean'] for k in names]
    axs[0,0].bar(x+(j-.5)*width,vals,width,label=f'{n:,} nodes',color=['#a8c5d8','#245a76'][j])
axs[0,0].set_xticks(x,labels,rotation=17,ha='right');axs[0,0].set_ylabel('Mean candidate gap (cp)');axs[0,0].set_title('A. Same 22 roots; lower is better',loc='left');axs[0,0].legend(frameon=False)
for i,n in enumerate([12000,48000]):
    v=s['quality'][str(n)+'-allCp']['comparisons']['pair-base']['deltaGap'];lo,hi=v['ci95'];m=v['mean']
    axs[0,1].errorbar(m,i,xerr=[[m-lo],[hi-m]],fmt='o',capsize=4,color='#cc6633',markersize=7)
axs[0,1].axvline(0,color='#64748b',ls='--');axs[0,1].set_yticks([0,1],['12,000 nodes','48,000 nodes']);axs[0,1].set_ylim(-.6,1.6);axs[0,1].set_xlabel('Pair minus base candidate gap (cp)');axs[0,1].set_title('B. Paired difference, 95% bootstrap interval',loc='left')
axs[1,0].bar(['Training positions','Base-reached leaves'],[-.0269358333,-103.7039986],color=['#94a3b8','#cc6633']);axs[1,0].axhline(0,color='#64748b',lw=1);axs[1,0].set_ylabel('Mean pair-model correction (cp)');axs[1,0].set_title('C. Zero mean on training does not transfer',loc='left')
for i,n in enumerate(['base','pair','affine','zeroGapDiagnostic']):
    v=st['variants'][n];axs[1,1].scatter(v['gapMaeCp'],v['rankAgreement20cp']*100,s=75,color=colors[i]);axs[1,1].annotate(['Base','Pair learned','Affine','Always predict zero gap'][i],(v['gapMaeCp'],v['rankAgreement20cp']*100),xytext=(5,[-14,14,-10,6][i]),textcoords='offset points',fontsize=9)
axs[1,1].set_ylim(-5,73);axs[1,1].set_xlim(455,640);axs[1,1].set_xlabel('Sibling gap MAE (cp; lower is better)');axs[1,1].set_ylabel('Rank agreement (%)');axs[1,1].set_title('D. Lower regression error can lose ranking',loc='left')
fig.suptitle('Shogi Search Lab v0.12 — evaluation learning and search distribution',fontsize=15)
fig.text(.06,.015,'24 new trajectories; shared opening families. No strength claim. The zero-gap point is a diagnostic, not an engine.',fontsize=10,color='#475569')
fig.savefig(D/'overview.png',dpi=170,facecolor='white');plt.close(fig)
print('Wrote REPORT-v0.12.md and overview.png')
