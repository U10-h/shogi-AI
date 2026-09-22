"""Write the final Japanese report from preserved raw-summary data."""
import json,hashlib,platform,difflib
from pathlib import Path
R=Path(__file__).resolve().parents[1];D=R/'results/v0.14'
read=lambda p:json.loads(p.read_text())
s=read(D/'summary.json');audit=read(D/'root-audit.json');train=read(D/'policy-training.json');n=audit['roots']
names=['base','capture','policy1capture','capturelmr'];labels={'base':'基準（v0.13相当）','capture':'駒取り履歴','policy1capture':'事前方策＋履歴','capturelmr':'履歴＋LMR'}
assert len(list((D/'matches').glob('*.json')))==48
assert len(list((D/'fixed').glob('*.json')))==n*4*3
assert len(list((D/'quality').glob('*.json')))==n
def table(headers,rows):return '| '+' | '.join(headers)+' |\n|'+'|'.join('---' for _ in headers)+'|\n'+'\n'.join('| '+' | '.join(map(str,row))+' |' for row in rows)+'\n'
def bounds(a,d=2):return f'[{a[0]:.{d}f}, {a[1]:.{d}f}]'
fixed=table(['方式','ノード比','探索時間比 [95%参考区間]','スコア変更','最善手変更'],[[labels[k],f"{s['fixed'][k]['nodeRatio']:.4f}",f"{s['fixed'][k]['timeRatio']:.4f} {bounds(s['fixed'][k]['timeRatio95CI'],3)}",s['fixed'][k]['scoreChanges'],s['fixed'][k]['moveChanges']]for k in names])
qt=[];qdetail=[]
for budget,title in [("{'nodes': 12000}",'12,000ノード'),("{'nodes': 48000}",'48,000ノード'),("{'ms': 1000}",'1秒')]:
 data=s['quality'][budget+' allCp'];assert all(data[k]['roots']==n for k in names)
 qt.append([title]+[f"{data[k]['meanGapCp']:.2f}" for k in names])
 for k in names[1:]:
  r=data[k];qdetail.append([title,labels[k],f"{r['meanDeltaGapCp']:.2f} {bounds(r['delta95CI'])}",f"{r['improved']} / {r['equal']} / {r['worse']}",f"{r['meanCompletedDepth']:.2f}"])
quality=table(['予算']+[labels[k] for k in names],qt)
qd=table(['予算','方式','平均差cp [95%参考区間]','改善 / 同等 / 悪化','平均完了深さ'],qdetail)
mt=[]
for k in names[1:]:
 r=s['matches'][k];assert r['starts']==8 and sum(r[x] for x in ['wins','losses','draws','unresolved'])==16
 mt.append([labels[k],f"{r['wins']}勝{r['losses']}敗・引分{r['draws']}・未決着{r['unresolved']}",f"{r['scoreRateWithUnresolvedHalf']:.3f} {bounds(r['score95CI'],3)}",r['moves']])
matches=table(['候補 対 基準','戦績','得点率 [8開始局面の参考区間]','着手数'],mt)
dev=table(['方式','深さ3ノード比','12k平均候補差cp','48k平均候補差cp'],[[labels[k],f"{s['devfixed-history'][k]['nodeRatio']:.4f}",f"{s['development-history'][str({'nodes':12000})+' allCp'][k]['meanGapCp']:.2f}",f"{s['development-history'][str({'nodes':48000})+' allCp'][k]['meanGapCp']:.2f}"]for k in names])
matches_count=sum(v['moves'] for v in s['matches'].values())
reduction=(1-s['fixed']['capture']['timeRatio'])*100
policy_selected=train['selected']['validation'];zero=train['zeroControl']
decision=read(D/'adoption.json')
text=f'''# v0.14：過去版の結果を踏まえた探索・学習の改善

実験日：2026-09-21（UTC）。NNUEは従来の固定重みとし、読み順の事前学習、探索中の駒取り履歴学習、LMRとの組合せを実装・比較した。

{decision['headline']}

## 過去版から何を引き継いだか

- v0.8・v0.9：NNUE差分計算、不要な評価・手生成の省略を維持した。
- v0.10〜v0.12：追加学習の静的誤差が減っても、単純補正との比較や別局面の棋力が安定しなかった。今回は評価値を変更せず、調べる手の順位を学習した。
- v0.11：初回反復が未完了でも、読み終えた根候補を緊急着手に使う修正を維持した。
- v0.13：学習型枝刈りは見落としを含み、実時間の改善を確認できなかったためoffを維持した。

固定版やねうら王の一次ソースからcapture history等の設計を参照した。対応と相違は `RESEARCH-v0.14.md` にまとめた。本家の探索コードは自作探索へリンクしていない。

## 実装した学習

**事前方策**：v0.10の128進行・11,273親局面・848,469合法な静かな手から、教師上位3候補の分布を学習した。別32進行・2,743局面で正則化を選択。25,392係数の疎な線形モデルを整数化し、駒種、移動先、玉との位置関係、王手、利きなどから10項の加算で優先度を出す。特徴生成の時間も測定に含めた。

検証cross entropyは{zero['crossEntropy']:.4f}→{policy_selected['crossEntropy']:.4f}、最上位予測が教師の静かな候補集合に入る率は{zero['topInTeacherQuietSet']*100:.2f}%→{policy_selected['topInTeacherQuietSet']*100:.2f}%。これは全合法手での最善手正答率や勝率ではない。教師上位外の手は未採点のため、ラベル0を悪手の証明と解釈しない。

**駒取り履歴**：探索中、βカットに成功した捕獲・成り手へ加点し、その前に読み終えた手へ減点する。キーは手番・動かす駒種・移動先・取る駒種。通常探索と静止探索で更新し、現在の探索中の経験へ適応する。予測だけで枝は省略しない。履歴は各探索の開始時にリセットされる。

**LMR**：後順位の静かな手を浅く確認し、αを超えた場合は元の深さで読み直す既存機構を再評価した。深さを減らすヒューリスティックなので、スコア保存の保証はない。今回、新たに学習したものは読み順であり、LMR自体を機械学習で最適化したわけではない。

## 開発実験と固定した候補

過去v0.13の24根を開発用に転用。事前方策の強さ3通り、LMR、各組合せを比較した。これは既知集合であり、新規試験ではない。

{dev}
事前方策単独はノード約2%減に対し、測定時間が約3〜6%増え、同一ノード条件の着手は基準と同じだった。履歴との併用では固定深さの仕事量は減ったが、候補差の改善は安定しなかった。履歴＋LMRは小予算の候補差が改善した。この結果から基準・履歴・事前方策＋履歴・履歴＋LMRの4方式を、新規試験の前にモデル・設定・バイナリのSHA-256で固定した。

## 新規局面の作り方

別seedの24進行を生成。非王手、16手以降、教師深さ6で絶対値250cp以下、offset24に近い順という事前条件で1進行1根を選び、{n}根を採用した。条件を満たさなかった3進行（ID 7・11・21）は除外し、条件を後から緩めていない。過去の教師データと進行の62,619正規化局面に対し、採用根の一致・左右反転一致はなかった。

開始戦型の系統は過去実験と共有している。全ての探索子孫が未見という意味ではなく、未知戦型への一般化や最新の強豪エンジン相手の成績は未検証である。

## 固定深さの速度と値

新規{n}根、深さ3、200万ノード上限。各方式3回、順序を回転し、他の実験終了後に直列で測定。表は根ごとの時間中央値を合計した比で、小さいほど速い。モデル読込み・プロセス起動時間は除く。ノード・PV・値が各3反復で一致することを確認した。

{fixed}
履歴だけのスコア保存と、有限時間で選ぶ手の良さは別の性質である。事前方策版は同点手の選択順を変えることがあり、スコアが同じでも指し手や長い探索の結論が同じとは限らない。LMR版は読みの範囲を変えるため、スコア変更を分けて示した。

## 同一ノード・同一時間での着手品質

固定教師YaneuraOu 6.03の深さ10で、4方式・全予算の選択手と教師自身の手を同じ候補集合として再採点した。表は、その集合の最高評価との差の平均cpで、小さいほど良い。全合法手を厳密に比較した損失ではない。全{n}根の候補がcpで比較可能だった。

{quality}
各候補の基準からの差は以下。負の値が改善。平均完了深さは方式ごとに読みの範囲が異なるため、同じ精度の読みの長さを意味しない。

{qd}
1秒条件は各根・方式1回の測定。固定深さの実時間測定と異なり、1秒条件には時間割込みの揺らぎが残る。ノード予算による結果と合わせて判断する。区間は進行単位の対応付きbootstrap 5,000回で、今回の候補比較は探索的である。多重比較補正を伴う有意差の主張はしていない。

## 悪化例：同点の選び方が変わった

新規試験ID 5、後手番。基準は `3c2b`、事前方策＋履歴は `6a5b` を選んだ。どちらも1秒で深さ4を完了し、自作評価は−324rawだった。教師深さ10では前者−220cp、後者−1465cpで、差は1,245cp。

事後診断で深さ4を完了させても結果は同じ。深さ5でも基準は `3c2b`、事前方策版は `6a5b`、両者の自作評価は−254raw。両候補を別々の全窓で探索しても、残り深さ3では−324、4では−254で一致した。今回の悪化を「推論が遅く、反復を完了できなかっただけ」と説明することはできない。

この局面では浅い探索が同点とする手の中で、学習が探索順を変えたことが選択を変えた。より深い教師の結論を区別できる学習対象が必要という仮説につながる。1局面の事後診断であり、失敗例を使ってモデルや閾値を再調整してはいない。`diagnosis.json` に12探索と原局面を保存した。

## 先後交換48対局

同じ新規8開始局面を各方式で先後交換し、候補ごとに基準と16局、計48局。双方1手12,000ノード、追加200手まで。詰み・合法手なし・反復だけで決着を判定し、上限到達は未決着とした。固定ノード対局の一部は独立ジョブとして並行実行した。そこで記録した実時間を速度評価には使っていない。

{matches}
引分・未決着がある場合の表示得点率では双方0.5点とするが、未決着は確定した引分とは別記する。区間は先後ペアを保ち8開始局面単位でbootstrapした参考値。少数の同系統局面であり、Eloや一般的な勝率へ換算しない。今回は対基準の自作エンジン戦であり、本家やねうら王への勝率試験ではない。

## 採用判断

{decision['details']}

## 検証・保存物

- 基礎115・継続探索1,274・拡張探索5,156、計6,545件の既存テストが通過。
- 独立ルール実装tsshogiにより59局面・4,270合法手で全10特徴と整数推論を照合。
- 12根で、変更前v0.13バイナリ・新しい基準・policy-scale0のスコア、PV、ノード、完了深さ、探索統計、緊急着手が一致。
- 新規比較{n*12}探索・固定深さ{n*12}探索・全48対局の着手とPVを独立検証。全対局{matches_count:,}着手、終端・反復の照合、KIFの読戻しを確認。
- 事後診断12探索、全3事前学習モデル、教師と特徴データ、凍結プロトコル、生結果、CSV、ソース差分を同梱。

実行例：`python3 scripts/run_v14.py capture --depth 16 --iterative --time-ms 1000 --max-nodes 1000000000`。`YANEURAOU_ASSETS` に固定NNUE資材のディレクトリを指定する。`capture` は履歴、`hybrid` は事前方策＋履歴、`selective` は履歴＋LMR、`base` は比較基準。`--usi` でGUIへ接続できる。詳しくは `REPRODUCE-v0.14.md`。
'''
(R/'REPORT-v0.14.md').write_text(text)
(R.parent/'shogi-v0.14-report.md').write_text(text)
patch=[]
for name in ['advanced.hpp','advanced.cpp','main.cpp']:
 a=(R/'checkpoints/v0.13/src'/name).read_text().splitlines(True);b=(R/'src'/name).read_text().splitlines(True)
 patch.extend(difflib.unified_diff(a,b,fromfile='a/src/'+name,tofile='b/src/'+name))
patch.extend(difflib.unified_diff([], (R/'src/policy.hpp').read_text().splitlines(True),fromfile='/dev/null',tofile='b/src/policy.hpp'))
(R/'CHANGES-v0.14.patch').write_text(''.join(patch))
paths=['src/advanced.cpp','src/advanced.hpp','src/main.cpp','src/policy.hpp','scripts/policy_v14.mjs','scripts/train_policy_v14.py','models/v0.14/quiet-policy.txt']
(D/'implementation-manifest.json').write_text(json.dumps({'platform':platform.platform(),'hashes':{p:hashlib.sha256((R/p).read_bytes()).hexdigest() for p in paths}},indent=2)+'\n')
print('Report written',len(text),matches_count)
