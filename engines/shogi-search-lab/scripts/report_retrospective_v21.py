#!/usr/bin/env python3
"""Create a source-backed Markdown report, research figures and Japanese PDF."""
import json, os, re, html, sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from retrospective_history import HISTORY, PAST_SPEED, PAST_YANEURA
R=Path(__file__).resolve().parents[1];D=R/'results/retrospective-20260927';F=D/'figures';F.mkdir(exist_ok=True)
S=json.loads((D/'summary.json').read_text());A=json.loads((D/'interpretation.json').read_text())
if '--draft' not in sys.argv:
 assert S['counts']=={'quality':384,'speed':216,'hard':60,'games':48,'moves':S['match_move_count'],'teachers':24},S['counts']
 assert json.loads((D/'audit.json').read_text())['passed']
labels={'traditional':'従来PVS','capture':'PVS＋駒取り履歴','lmr':'PVS＋履歴＋LMR','adaptive':'選択的・方策なし','latest':'最新構成 v0.20','nocache':'評価cacheなし','scalar':'scalar＋全件整列'}
english={'traditional':'PVS','capture':'PVS + capture history','lmr':'PVS + history + LMR','adaptive':'Adaptive, no policy','latest':'Adaptive + root policy'}
colors=['#7e8c9c','#356c9b','#b07636','#855f9c','#117e7b']
def fmt(x,d=2):return '-' if x is None else f'{x:,.{d}f}'
def table(headers,rows):return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+['| '+' | '.join(map(str,r))+' |' for r in rows])
def q(v,ms):return next(x for x in S['quality'] if x['variant']==v and x['ms']==ms)
def fig(name,caption):return f'![{caption}](results/retrospective-20260927/figures/{name}.png)\n\n{caption}'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.titleweight':'bold','savefig.facecolor':'white','figure.facecolor':'white'})
f,ax=plt.subplots(figsize=(8.4,3.0));sp=S['speed'];vals=[x['ratio_to_nocache'] for x in sp];
ax.barh(['SIMD, no cache','SIMD + evaluation cache','Scalar + eager ordering'],vals,color=['#7e8c9c','#117e7b','#b07636'],height=.55)
ax.errorbar(vals,range(3),xerr=np.array([[v-x['ci'][0] for v,x in zip(vals,sp)],[x['ci'][1]-v for v,x in zip(vals,sp)]]),fmt='none',ecolor='#18384e',capsize=4)
for i,v in enumerate(vals):ax.text(v+.05,i,f'{v:.3f}',va='center')
ax.axvline(1,color='#82949d',ls='--',lw=1);ax.set_xlim(0,max(vals)+.3);ax.set_xlabel('Search-time ratio (lower is better)');ax.invert_yaxis();f.tight_layout();f.savefig(F/'speed.png',dpi=190);plt.close(f)
f,ax=plt.subplots(figsize=(8.4,3.2))
for c,v in zip(colors,S['protocol']['names']):
 rs=[x for x in S['quality'] if x['variant']==v];ax.plot([x['ms']/1000 for x in rs],[x['gap'] for x in rs],marker='o',label=english[v],color=c,lw=1.7)
ax.set_xlabel('Search time per position (seconds)');ax.set_ylabel('Mean teacher candidate gap (cp)');ax.set_ylim(bottom=0);ax.grid(alpha=.15);ax.legend(fontsize=8,ncol=2);f.tight_layout();f.savefig(F/'quality.png',dpi=190);plt.close(f)
f,axs=plt.subplots(1,2,figsize=(8.4,3.0));rs=[q(v,1000) for v in S['protocol']['names']];x=np.arange(5)
axs[0].bar(x,[r['nodes_mean']/1000 for r in rs],color=colors);axs[0].set_ylabel('Visited nodes (thousands)');axs[0].set_title('1-second search')
axs[1].bar(x-.18,[r['seldepth_mean'] for r in rs],.36,label='Maximum reached',color='#356c9b');axs[1].bar(x+.18,[r['pv_mean'] for r in rs],.36,label='Returned PV',color='#117e7b');axs[1].set_ylabel('Plies');axs[1].legend(fontsize=8)
for ax in axs:ax.set_xticks(x,['PVS','CH','LMR','Adapt.','Latest'],rotation=0);ax.grid(axis='y',alpha=.15)
f.tight_layout();f.savefig(F/'depth-nodes.png',dpi=190);plt.close(f)
f,ax=plt.subplots(figsize=(8.4,3.2));gs=S['games'];y=np.arange(len(gs));left=np.zeros(len(gs))
for outcome,col in [('win','#117e7b'),('draw','#a4b9b6'),('loss','#c16b64'),('unresolved','#d5b478')]:
 vals=np.array([g[outcome] for g in gs]);ax.barh(y,vals,left=left,color=col,label=outcome.title());left+=vals
ax.set_yticks(y,[f"{english[g['a']]} vs "+(english[g['b']] if g['b']!='yaneuraou' else 'YaneuraOu / '+g['suite']) for g in gs],fontsize=8);ax.invert_yaxis();ax.set_xlabel('Games');ax.legend(ncol=4,fontsize=8,loc='lower left',bbox_to_anchor=(0,1.01),frameon=False);f.tight_layout();f.savefig(F/'games.png',dpi=190);plt.close(f)
P=[]
P.append('''# 将棋AI研究 成果総括・追加検証

Shogi Search Lab / v0.1–v0.20

**報告日：2026年9月27日　対象：最新保存ソースと過去19報告書**

'''+A['summary']+'\n\n'+table(['今回追加した検証','規模'],[
('やねうら王との対戦','12局（生成開始8局＋平手初期から4局）'),('既存探索・機能差の対戦','36局（3比較×6開始局面×先後交換）'),('新規局面での固定時間比較','24局面・384探索、0.3/1/3秒＋最新5秒'),('同一10万ノードの速度比較','24局面×3方式×3反復＝216探索'),('既知の難しい終盤','6局面×5方式×1/3秒＝60探索'),('教師評価の感度分析','事後選択7局面を深さ12→16で再採点')])+'\n\n'+
'''**読み方。** 過去の成果は当時の実験条件での結果として記載し、今回の追試と分けた。既存手法は同じC++基盤でのPVS・LMR等の実装で比較した。対戦相手のやねうら王は固定版6.03 / WASM・2019年のKP256評価であり、最新の強豪構成ではない。

本書は「速くなった」「深く進んだ」「良い手を選んだ」「対局に勝った」を別の成果として評価する。結果を保つ高速化と、探索範囲を変える工夫を区別した。''')
P.append('''# 1　研究の目的と、作ったもの

限られた計算時間で有力な変化を多く読み、その根拠となる局面・読み筋を人が確認できる将棋AIを目指した。研究の中心は、評価・探索順序・枝刈り・計算費用の関係を観測し、仮説を実装と対照実験で確かめることにある。

合法手生成・盤面更新は固定版やねうら王のコードを再利用し、探索・評価互換処理・実験・観測部分をC++17で構築した。上位5候補を保持するsession機能と、各種探索方式を比較するadvanced機能がある。最新の対局実験は毎手advanced探索を作り直すため、sessionの保持木やponderの効果は含まない。

ナースロスタリングの構造解析との接点は、仮着手の影響、評価境界の変化、どの枝がどの根拠で省略されたかを記録する研究方法にある。将棋では相手の応手を自由に固定できないため、応手数の減少そのものを安全な枝刈りの根拠にはしない。

## 評価指標の定義

'''+table(['指標','今回の測り方・解釈'],[
('1. 対やねうら王','勝・敗・引分・未決着を分離。開始局面と先後をそろえる。'),('2. 既存手法との対戦','同じNNUE・計算基盤のPVS / PVS＋LMRと比較。機能を外す対照も用意。'),('3. 実行時間','探索本体elapsed_msと、起動・モデル読込等を含むwallMsを別記。'),('4. 読み深さ','PVSの完了深さ、最大到達手数、返したPVの長さを分離。1手＝1ply。'),('5. 探索ノード数','再訪問・静止探索を含む訪問数。異なる木では少ないほど良いとは限らない。'),('6. 補助指標','NPS、教師候補差、100cp超の候補差、初回未完了、時間超過、PV合法性、静止探索比率。')])+
'''\n\n教師候補差は「比較対象全方式・全時間の着手と教師の着手を集めた集合」での最高評価との差。全合法手の真の最善手損失ではない。教師と自作側は同じ基礎NNUEを用いるため、独立した棋力指標にはならない。''')
P.append('# 2　研究の経緯：探索基盤からNNUEまで\n\n'+table(['版・主題','確認された結果','解釈・限界'],[(v+' / '+t,r,l) for v,t,r,l in HISTORY[:9]])+'\n\n**この段階の主成果。** まず同じ答えをより少ない計算で得る基盤を整え、次に評価関数の情報量を増やした。特にNNUE導入時は、平均完了深さが増えていなくても教師候補差が改善した。深さだけでは性能を評価できない実例である。')
P.append('# 3　研究の経緯：学習と選択的探索\n\n'+table(['版・主題','確認された結果','解釈・限界'],[(v+' / '+t,r,l) for v,t,r,l in HISTORY[9:]])+'\n\nv0.17だけは当時の独立した報告と原データを確認できなかった。後続版の保存結果と今回の方策有無の対照から、現在の挙動を評価する。過去の各版を新しい順に強いとみなさない。')
P.append('''# 4　追加実験の条件

ソースはGitHubのwork/v0.20-recent-research、コミット4f94f7baf775c4c3870e5d9863536305b4902deb。探索ロジック・モデル・パラメータを変更せず、実験用スクリプトと集計・監査を追加した。開始前に方式、乱数種、予算、ハッシュを固定し、結果を見て方式を選び直していない。

'''+table(['略称','方式','比較の目的'],[
('従来PVS','PVS＋TT＋history/killer/counter＋静止探索','既存探索の基準'),('PVS＋駒取り履歴','従来PVSにcapture historyを追加','v0.14の機能効果を再確認'),('PVS＋履歴＋LMR','駒取り履歴版に既存LMRを追加','既存の選択的な深さ削減と比較'),('選択的・方策なし','費用ベースのadaptive探索','探索配分そのものを比較'),('最新構成 v0.20','adaptive＋学習済み根方策＋静的評価cache','現在の保存構成を評価')])+
'''\n\n5方式は同じ固定NNUEと静的評価cacheを使用し、評価の計算速度差をそろえた。adaptiveの静止探索は固定6手で切らず継続する。通常探索方式の上限は16手、adaptiveは費用反復と95手の非常停止。通常方式が上限で停止した件数もログに残した。

**局面。** 新seed270901〜270908の8進行から28/44/60手後を採り、24局面を生成。教師の深さ6・上位3候補中100cp以内から序盤を変化させた。保存済み根JSONとの完全一致を除外したが、配布NNUEの学習局面や全探索子孫との非重複は保証できない。未知戦型を網羅する試験ではない。

**対局。** 生成進行の20手後から先後交換。内部比較は各手200ms、対やねうら王は双方1,000ms。定跡・ponderなし、1スレッド、毎手fresh/reset。追加200手で終わらなければ未決着。評価値で勝敗を早期判定しない。時間超過を即負けにはせず、実際の時間を計測する。

**開始局面の補足。** 対やねうら王用の生成局面は教師深さ6で先手+217/+2,092cp。後者は大差のある開始条件だったため、相手との対局結果を見る前に平手初期からの先後交換4局を追加した。元の8局は保持し、初期局面の4局と分けて集計する。

自作はネイティブC++、相手はWASM。同じ1秒での実システム比較であり、NPSの差を探索アルゴリズムだけの差とは解釈しない。

**集計。** 探索は直列実行し設定順を回転。速度は3回の局面別中央値の合計比。区間は8進行を単位に10,000回再標本化した参考95%区間。24局面を24独立標本とは数えない。対局も開始局面の先後ペアを保つ。共有CPU環境・少数進行の結果であり、一般的なEloには換算しない。''')
sp=S['speed'];P.append('# 5　実行時間：同じ読みを速く処理できたか\n\n'+fig('speed','図1　同一10万ノードの探索時間比。破線はSIMD・cacheなし。横線は8進行単位の参考95%区間。')+'\n\n'+table(['計算法','中央値合計 ms','時間比 [参考95%区間]'],[(labels[x['variant']],fmt(x['sum_median_ms']),f"{x['ratio_to_nocache']:.3f} [{x['ci'][0]:.3f}, {x['ci'][1]:.3f}]") for x in sp])+'\n\n'+A['speed']+'''\n\n216探索すべてで、比較する3方式のscore・PV・nodes・完了反復・停止理由・未完了時PVが対応して一致した。今回のscalar対照は最新コードからSIMDと遅延順序付けを外したもので、旧v0.14バイナリの厳密な復元比較ではない。

過去の34.6%、19.6%、49.9%、4.0%、4.53%は異なる局面・条件・基準の測定である。掛け合わせて「累積で何倍」とは主張しない。また、同じ持ち時間でノード数が増えることと、勝率が増えることを区別する。''')
P.append('# 6　着手品質と、長く考える効果\n\n'+table(['方式','0.3秒 cp','1秒 cp','3秒 cp','5秒 cp'],[(labels[v],fmt(q(v,300)['gap']),fmt(q(v,1000)['gap']),fmt(q(v,3000)['gap']),fmt(q(v,5000)['gap']) if v=='latest' else '―') for v in S['protocol']['names']])+'\n\n'+fig('quality','図2　共通候補集合に対する教師評価差。小さいほど良い。固定やねうら王の深さ12による近似評価。')+'\n\n'+A['quality']+'\n\n'+A['time']+'\n\n通常cpで比較できる根数は各方式・予算とも'+str(q('latest',1000)['cp_n'])+' / 24。詰み・特殊値（絶対値30,000以上）を含む候補集合はcp平均から除外し、元データは保持する。自作の生評価値（歩90）とは混ぜない。各条件は1回の時間制限探索であり、着手の時間変動も含む。')
P.append('# 7　深さ・探索量・応答時間\n\n'+table(['予算・方式','探索 ms','ノード/探索','通常深さ','最大到達','PV手数'],[(str(ms//1000)+'秒 '+labels[v],fmt(q(v,ms)['elapsed_mean'],1),fmt(q(v,ms)['nodes_mean'],0),fmt(q(v,ms)['normal_depth'],2),fmt(q(v,ms)['seldepth_mean'],2),fmt(q(v,ms)['pv_mean'],2)) for ms in [1000,3000] for v in S['protocol']['names']])+'\n\n'+fig('depth-nodes','図3　1秒探索の訪問ノードと、最大到達手数・返したPV。これらは同じ意味の「深さ」ではない。')+'\n\n'+A['depth']+'\n\nadaptiveの通常深さ欄は対象外。「最大到達」は最深の一本であり、全候補をその深さまで確認した保証ではない。ノード数には静止探索と再訪問を含む。NPS・起動込み時間・停止理由の全値はquality-summary.csvに保存した。')
P.append('# 8　対局：既存手法と、やねうら王\n\n'+table(['左側から見た比較','勝','敗','引分','未決着','開始局面'],[(labels[g['a']]+' 対 '+(labels[g['b']] if g['b']!='yaneuraou' else 'やねうら王'+('（初期）' if g['suite']=='startpos' else '（生成）')),g['win'],g['loss'],g['draw'],g['unresolved'],g['opening_clusters']) for g in S['games']])+'\n\n'+fig('games','図4　全48対局の内訳。自作同士は200ms/手、対やねうら王は双方1秒/手。')+'\n\n'+A['games']+'\n\n対局数は独立標本数ではない。内部比較は6開始局面、対やねうら王は生成2局面と平手初期局面のみ。手数が伸びたことは抵抗の長さを示す補助観測だが、それだけでは棋力差の証拠にならない。詳細な棋譜・各手のPV・ノード・時間・終了理由を保存した。保存進捗の不整合により内部比較3局を記録済みの全履歴から再開した。既存KIFのあった2局は再開後も棋譜が完全一致し、記録を保持している。')
P.append('# 9　難しい終盤と、失敗例\n\n'+table(['方式','既知終盤1秒：初回完了','既知終盤3秒：初回完了','新24局面1秒：初回完了'],[(labels[v],next(f"{x['completed']}/{x['n']}" for x in S['hard'] if x['variant']==v and x['ms']==1000),next(f"{x['completed']}/{x['n']}" for x in S['hard'] if x['variant']==v and x['ms']==3000),str(q(v,1000)['completed'])+'/24') for v in S['protocol']['names']])+'\n\n'+A['hard']+'\n\n今回の48対局における自作側の初回未完了は、全'+str(sum(x['n'] for x in S['match_metrics'] if x['variant']!='yaneuraou'))+'着手中'+str(sum(x['fallback'] for x in S['match_metrics'] if x['variant']!='yaneuraou'))+'件だった。既知難局面の失敗率とは分けて解釈する。'+'''\n\n## 時間内に答えを返す品質

探索を中断して最後の完了反復を返せることと、最初の候補比較さえ終わらないことを区別した。未完了時は、読み終えた根候補または緊急の合法手を返す。そのPVを「十分に読んだ結果」とは表示しない。

'''+table(['方式・1秒','探索p95 ms','起動込みp95 ms','5%＋5ms超過/24'],[(labels[v],fmt(q(v,1000)['elapsed_p95'],2),fmt(q(v,1000)['wall_p95'],2),q(v,1000)['over5pct']) for v in S['protocol']['names']])+'\n\n'+A['cases']+'\n\n既知終盤6局面は、過去1対局から抽出した診断集合である。通常対局での発生頻度の推定には使わない。全探索PVと全棋譜は別のルール実装tsshogiで合法性・終端・KIF読戻しを検査した。既存の自己検査7,128項目も通過した。')
P.append('''# 10　成果の評価を更新する

## 成果として残ること

探索結果を保つ高速化、評価関数の互換実装、失敗を追跡できる実験基盤は、局所的な対局結果とは分けて積み上げられる。特に静止探索の費用、初回比較の未完了、学習による探索葉の分布変化を実際のログで観測できるようになった。

## 改善を断定しないこと

'''+table(['当初の観測','追試・対照で分かったこと','現時点の判断'],[
('評価学習が25勝7敗','v0.11では+40cp対照に14勝18敗。4倍ノードでは7勝8敗・未決着1。','学習固有の優位は未確認。'),('候補差の予測誤差が減少','v0.12の倍率補正対照には12k/48kとも6勝10敗。','静的誤差と棋力の改善は別。'),('学習型枝刈りで省略できる','v0.13の新規監査でα更新の見落とし。時間比1.0227。','標準採用しない。'),('読みを保存すれば有利','v0.18のqcacheは3/5秒で悪化、v0.19入口保存は新規局面で同等。','保存・照合の費用を含めて判断。'),('新しい補正で開発成績向上','v0.20のcorrectionは新24局面で悪化。SEEも局所見落とし。','開発集合の最良値を成果としない。')])+'\n\n'+A['decision']+'''\n\n研究上の貢献は、既存手法を組み合わせた際の有効条件・失敗条件を、速度・候補品質・勝敗の対照とログで示した点にある。新しい枝刈り理論の証明、既存強豪を超える棋力、NNUE全体の独自学習を達成したとは位置付けない。''')
P.append('''# 11　次の研究課題と再現方法

**優先1：初回候補比較への計算配分。** 難所で静止探索の一本が予算を使い切る原因を、根候補別ノード・中断位置・反論発見時刻で追う。固定上位k手の切捨てより、候補の未確認範囲と再探索の費用を明示する設計を優先する。

**優先2：方策を置く場所と学習対象。** 根の手順序だけでなく、浅い評価が同点にする候補、深い教師との不一致、最初の反論を発見するまでのノード数を教師信号の候補にする。今回の24局面は以後開発用とし、採用判断には別の進行を使う。

**優先3：棋力試験の独立性。** 開始局面の数と戦型を増やし、200msと秒単位を別試験にする。最新のネイティブ版やねうら王・別の評価関数・別系統エンジンで、同一NNUE教師に依存しない評価を行う。これは今後の課題で、今回実施済みではない。

## 再現・保存物

ソース・スクリプト・生JSON・教師応答・CSV・KIF・プロトコル・ハッシュは、work/research-summary-20260927ブランチのengines/shogi-search-labに保存。実験ごとのファイルはresults/retrospective-20260927以下。過去の報告とデータは上書きしていない。

実行順はビルド・自己検査 → 条件固定 → 一次実験 → 平手初期からの補助対局 → 深さ16診断 → 集計・独立監査。追試ではV21_RESULTSに新しい出力先を指定する。評価資材は既存fetch_opponent.pyで取得・照合する。詳しい手順はREPRODUCE-retrospective-20260927.mdを参照。

## 根拠資料

本書の過去数値はREPORT.md、REPORT-v0.2.md〜v0.20.md（v0.17欠落）および対応するsummary.jsonに基づく。historical-inventory.jsonに存在確認とSHA-256を記録した。過去の時間短縮率は別条件のため合算しない。

1. Tsuruoka, Yokoyama & Chikayama (2002), Game-Tree Search Algorithm Based on Realization Probability. https://www.nactem.ac.uk/tsuruoka/papers/icga02.pdf
2. Stockfish公式 NNUE技術資料（整数推論・差分計算・SIMD）。https://official-stockfish.github.io/docs/nnue-pytorch-wiki/docs/nnue.html
3. 対戦相手の固定ソース：arashigaoka/YaneuraOu.wasm, b2defb6d255ea44b3fead30e13f28b96e0ab0cc7。THIRD_PARTY.mdと資材ハッシュも参照。

選択的探索は実現確率探索の考え方を参照するが、本実装の費用は履歴・手の性質に基づく規則であり、棋譜から校正した確率ではない。NNUEのSIMD化も既存原理の実装であり、その独自発明を主張しない。''')
P.append('# 付録　過去の主要な速度・対局比較\n\n## 条件をそろえた当時の速度測定\n\n'+table(['版・変更','ノード','速度・時間','元の条件'],[(v+' '+t,n,s,c) for v,t,n,s,c in PAST_SPEED])+'\n\n各行で評価関数・深さ・局面・比較基準が異なるため、行をまたいで短縮率を合算・乗算しない。固定ノード・固定深さ・固定時間を区別して元の報告へ遡れるようにした。\n\n## 固定やねうら王との過去の対局\n\n'+table(['版・自作側','局数','成績','条件'],[(v+' '+t,n,r,c) for v,t,n,r,c in PAST_YANEURA])+'\n\nこれらの対戦相手も歴史的な固定版であり、最新ネイティブ版ではない。時代順の手数や勝率を、同一条件の棋力変化として扱わない。今回の追加対局は第8節に開始条件ごとに掲載した。')
diagnostic_rows=[]
for id in dict.fromkeys(x['id'] for x in S.get('depth_sensitivity',[])):
 ds=[x for x in S['depth_sensitivity'] if x['id']==id]; d12=next(x for x in ds if x['depth']==12);d16=next(x for x in ds if x['depth']==16)
 def benefit(x):return f"{x['cp_benefit']:+.0f}cp" if x['cp_benefit'] is not None else f"左 {x['a_type']} {x['a_score']} / 右 {x['b_type']} {x['b_score']}"
 comparison=('最新3秒 - 駒取り履歴3秒' if d12['b']=='capture' else f"最新{d12['a_ms']/1000:g}秒 - 最新{d12['b_ms']/1000:g}秒")
 diagnostic_rows.append((id,comparison,benefit(d12),benefit(d16)))
P.append('# 付録B　より深い教師による感度分析\n\n'+table(['局面ID','比較（左の着手 - 右の着手）','深さ12','深さ16'],diagnostic_rows)+'\n\n正のcp差は左側の着手の評価が高いことを表す。各行で同じ候補集合を使い、教師の探索深さだけを12から16に増やした。詰み評価になった場合はcpに置換せず、値の種類と両候補を記載する。局面IDの後半は初期局面からの手数で、根の棋譜はroots.jsonに保存した。\n\n'+A['cases']+'\n\n**事後診断の限界。** 対象は3秒の大きな改善3根・最大悪化1根と、探索時間を変えると評価が変わった3根を、最初の結果を見た後で選んだ。独立した追試集合ではなく、全24根の平均や対局勝率の再推定には使わない。深さ16も厳密な正解ではない。\n\n**cp平均から除外した局面。** 4-60では教師がG*6aを詰み負け14手、7i7hを詰み負け6手と評価した。詰み距離を通常cpと混ぜず、元の候補と着手を保存した。除外基準は候補集合全体に適用し、方式ごとに異なる根を使わない。\n\n**監査。** 48局の全着手・棋譜読戻し、660探索の返却PV、深さ12の24根と深さ16の7根の教師PVを独立に再生した。検査対象数とSHA-256はaudit.json / manifest.jsonに記録した。')
P=[x.replace('–','-').replace('―','-') for x in P]
md='\n\n<!-- PAGEBREAK -->\n\n'.join(P)+'\n';(R/'REPORT-retrospective-20260927.md').write_text(md)

# ReportLab uses embedded Japanese TrueType fonts, with visible page boundaries.
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,Image,KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors as rc
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
assets=Path(os.environ.get('REPORT_ASSETS',str(R/'build/report-assets')))
pdfmetrics.registerFont(TTFont('JP',str(assets/'NotoSansJP-400.ttf')));pdfmetrics.registerFont(TTFont('JPB',str(assets/'NotoSansJP-700.ttf')))
pdfmetrics.registerFontFamily('JP',normal='JP',bold='JPB',italic='JP',boldItalic='JPB')
styles={
 'body':ParagraphStyle('body',fontName='JP',fontSize=10.2,leading=17,spaceAfter=8,wordWrap='CJK',textColor=rc.HexColor('#233b4b')),
 'h1':ParagraphStyle('h1',fontName='JPB',fontSize=17,leading=24,spaceAfter=16,textColor=rc.HexColor('#17364b'),keepWithNext=True,wordWrap='CJK'),
 'h2':ParagraphStyle('h2',fontName='JPB',fontSize=11,leading=17,spaceBefore=10,spaceAfter=7,textColor=rc.HexColor('#117e7b'),keepWithNext=True,wordWrap='CJK'),
 'table':ParagraphStyle('table',fontName='JP',fontSize=8.6,leading=13,wordWrap='CJK'),
 'th':ParagraphStyle('th',fontName='JPB',fontSize=8.6,leading=13,textColor=rc.white,wordWrap='CJK')}
def markup(s):
 s=html.escape(s);s=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',s);s=re.sub(r'`([^`]+)`',r'\1',s);return s
def para(s,sty='body'):return Paragraph(markup(s),styles[sty])
story=[];width=A4[0]-84
for page in P:
 if story:story.append(PageBreak())
 lines=page.splitlines();i=0
 while i<len(lines):
  line=lines[i].strip()
  if not line:i+=1;continue
  if line.startswith('# '):story.append(para(line[2:],'h1'));i+=1;continue
  if line.startswith('## '):story.append(para(line[3:],'h2'));i+=1;continue
  if line.startswith('!['):
   m=re.match(r'!\[(.*?)\]\((.*?)\)',line);im=Image(str(R/m.group(2)));im.drawHeight=im.imageHeight/im.imageWidth*width;im.drawWidth=width;story.extend([im,Spacer(1,8)]);i+=1;continue
  if line.startswith('| '):
   data=[]
   while i<len(lines) and lines[i].strip().startswith('|'):
    cells=[x.strip() for x in lines[i].strip().strip('|').split('|')]
    if not all(re.fullmatch(r'[-: ]+',x) for x in cells):data.append(cells)
    i+=1
   cols=len(data[0]);ratios={2:[.30,.70],3:[.24,.39,.37],4:[.29,.23,.23,.25],5:[.32,.17,.17,.17,.17],6:[.38,.10,.10,.10,.14,.18]}.get(cols,[1/cols]*cols)
   if cols==6 and data[0][0]=='予算・方式':ratios=[.29,.13,.19,.13,.13,.13]
   t=Table([[para(c,'th' if j==0 else 'table') for c in row] for j,row in enumerate(data)],colWidths=[width*x/sum(ratios) for x in ratios],repeatRows=1,hAlign='LEFT')
   t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),rc.HexColor('#17364b')),('ROWBACKGROUNDS',(0,1),(-1,-1),[rc.HexColor('#f0f5f6'),rc.white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),.7,rc.HexColor('#117e7b'))]));story.extend([t,Spacer(1,10)]);continue
  text=[line];i+=1
  while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','![')):
   text.append(lines[i].strip());i+=1
  story.append(para(' '.join(text)))
out=Path(os.environ.get('REPORT_OUTPUT',str(R/'build/将棋AI研究_成果総括と追加検証_20260927.pdf')));out.parent.mkdir(parents=True,exist_ok=True)
def decoration(c,doc):
 c.setStrokeColor(rc.HexColor('#117e7b'));c.setLineWidth(1);c.line(42,A4[1]-31,A4[0]-42,A4[1]-31)
 c.setFont('JP',7.5);c.setFillColor(rc.HexColor('#6f8290'));c.drawString(42,A4[1]-23,'SHOGI SEARCH LAB  |  RESEARCH REVIEW 2026.09.27');c.drawString(42,23,'v0.1-v0.20 / 追加検証・原データ付き');c.drawRightString(A4[0]-42,23,str(doc.page))
doc=SimpleDocTemplate(str(out),pagesize=A4,rightMargin=42,leftMargin=42,topMargin=46,bottomMargin=43,title='将棋AI研究 成果総括と追加検証',author='Shogi Search Lab')
doc.build(story,onFirstPage=decoration,onLaterPages=decoration)
print(json.dumps({'pdf':str(out),'markdown':str(R/'REPORT-retrospective-20260927.md'),'sections':len(P)},ensure_ascii=False))
