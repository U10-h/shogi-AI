"""Generate the Japanese continuation report from measured summaries."""
import json
import os
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from fontTools.ttLib import TTFont as Font
from fontTools.varLib.instancer import instantiateVariableFont

ROOT=Path(__file__).resolve().parents[1]
D=Path(os.environ.get('V21_RESUME',ROOT/'results/verification-resume-20260927'))
S=json.loads((D/'summary.json').read_text())
ASSETS=Path(os.environ['REPORT_ASSETS'])
OUTPUT=Path(os.environ['REPORT_OUTPUT']);OUTPUT.parent.mkdir(parents=True,exist_ok=True)
for weight in [400,700]:
    path=ASSETS/f'NotoSansJP-{weight}.ttf'
    if not path.exists():instantiateVariableFont(Font(ASSETS/'NotoSansJP-variable.ttf'),{'wght':weight},inplace=True).save(path)
    pdfmetrics.registerFont(TTFont('JP' if weight==400 else 'JPB',str(path)))
pdfmetrics.registerFontFamily('JP',normal='JP',bold='JPB')
INK=colors.HexColor('#183047');TEAL=colors.HexColor('#087f8c');MUTED=colors.HexColor('#536579')
styles={
    'title':ParagraphStyle('title',fontName='JPB',fontSize=21,leading=30,textColor=INK,spaceAfter=13,wordWrap='CJK'),
    'h':ParagraphStyle('h',fontName='JPB',fontSize=12.5,leading=19,textColor=TEAL,spaceBefore=12,spaceAfter=7,wordWrap='CJK'),
    'body':ParagraphStyle('body',fontName='JP',fontSize=9.6,leading=16,textColor=INK,spaceAfter=9,wordWrap='CJK'),
    'small':ParagraphStyle('small',fontName='JP',fontSize=8.1,leading=12.5,textColor=MUTED,spaceAfter=7,wordWrap='CJK'),
    'cell':ParagraphStyle('cell',fontName='JP',fontSize=8.4,leading=13,textColor=INK,wordWrap='CJK'),
    'head':ParagraphStyle('head',fontName='JPB',fontSize=8.3,leading=13,textColor=colors.white,wordWrap='CJK'),
}
story=[];md=[]
def p(text,style='body'):
    story.append(Paragraph(escape(text),styles[style]));md.append(text+'\n')
def h(text):
    story.append(Paragraph(escape(text),styles['h']));md.append('## '+text+'\n')
def title(text):
    story.append(Paragraph(escape(text),styles['title']));md.append('# '+text+'\n')
def table(headers,rows,widths):
    data=[[Paragraph(escape(str(c)),styles['head']) for c in headers]]+[[Paragraph(escape(str(c)),styles['cell']) for c in row] for row in rows]
    t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#f0f5f7'),colors.white]),
        ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
        ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,-1),(-1,-1),.5,colors.HexColor('#cbd8df'))]))
    story.extend([t,Spacer(1,10)])
    md.append('| '+' | '.join(headers)+' |\n| '+' | '.join(['---']*len(headers))+' |\n'+'\n'.join('| '+' | '.join(str(c) for c in row)+' |' for row in rows)+'\n')
def page():story.append(PageBreak())
def f(n):return f'{n:.2f}'

title('将棋AI研究\n検証再開・追補報告')
p('2026年9月27日 / v0.20の探索・モデルは変更せず、測定と評価を追加', 'small')
p('高速化は再現した。一方、最新構成の着手品質が駒取り履歴版より優れるという判断は、教師の読みを深くして全局面を調べると維持できなかった。前回の成果総括に、この評価の修正を追補する。')
h('1. 停止したように見えていた検証の確認')
p('最新の保存物には48対局・660探索が完了した状態で残っていた。記録されていた中断3局は、その後に全履歴を引き継いで終局まで再開済みだった。今回、原データのハッシュと棋譜・読み筋を再検査した。')
table(['区分','今回確認・実施した内容'],[
    ['前回記録の監査','354ファイルのハッシュ一致。48対局4,707着手、660探索のPV、48棋譜の読戻しを再検査。'],
    ['速度の追試','24局面 × 3方式 × 3反復 = 216探索を新たに実行。各探索10万ノード。'],
    ['教師評価の拡張','事後に選んだ7局面から全24局面へ拡張。47候補を深さ16で再採点。以前の7局面も再実行。'],
    ['自作側の既存着手','前回の384探索で得た着手を固定して再採点。時間制限探索は再実行せず、採点条件を変更。'],
    ['対局・実装','新規対局は0局。対局結果は監査した既存48局。探索・評価・学習モデルに変更なし。'],
], [112,399])
h('2. 高速化は、今回も同じ結果を保って再現')
speed={r['variant']:r for r in S['speed']}
table(['方式','中央値合計','時間比','参考95%区間'],[[name,f(speed[v]['sum_median_ms'])+' ms',f(speed[v]['ratio']),f(speed[v]['ci'][0])+' - '+f(speed[v]['ci'][1])] for v,name in [('nocache','cacheなし'),('latest','静的評価cacheあり'),('scalar','scalar＋全件整列')]], [166,113,85,147])
p(f"評価cacheは{100*(1-speed['latest']['ratio']):.2f}%短縮（前回8.84%）。24局面中21局面で速かった。起動・モデル読込込みでも{100*(1-speed['latest']['wall_ratio']):.2f}%短縮した。216探索すべてで比較方式間の値・PV・ノード・完了反復・停止理由等が一致し、前回の対応結果とも一致した。")
p('速度は局面別3反復の中央値を合計した比。区間は8進行単位の10,000回bootstrap。共有CPU環境での追試であり、棋力の向上率には読み替えない。','small')

page();title('着手品質の判断を更新')
p('教師は前回と同じ固定やねうら王6.03 / WASM・KP256評価。候補集合を固定し、深さ12から16への感度を調べた。全合法手の厳密な最善手損失ではなく、共通候補集合の最高評価との差である。')
h('3. 深さ16・全24局面での再採点')
q={(r['variant'],r['ms']):r for r in S['quality'] if r['depth']==16}
table(['方式','0.3秒','1秒','3秒','5秒'],[[name]+[f(q[v,ms]['gap']) if (v,ms) in q else '-' for ms in [300,1000,3000,5000]] for v,name in [('traditional','従来PVS'),('capture','PVS＋駒取り履歴'),('lmr','PVS＋履歴＋LMR'),('adaptive','選択的・方策なし'),('latest','最新構成')]], [187,81,81,81,81])
p('単位cp、値が小さいほど良い。通常cpの集計は21局面。1-44は特殊値31,111cp、1-60と4-60は詰み評価を含むため、候補集合全体を通常cp平均から除外した。前回は23局面だったので、深さ間の比較には共通21局面も用いた。','small')
h('4. 同じ21局面で比較すると、優位は不確か')
cc={(r['depth'],r['b']):r for r in S['common_comparisons']}
table(['最新3秒 - 対照3秒','教師深さ12','教師深さ16','深さ16の参考区間'],[[name,f(cc[12,v]['delta'])+'cp',f(cc[16,v]['delta'])+'cp',f(cc[16,v]['ci'][0])+' ～ '+f(cc[16,v]['ci'][1])] for v,name in [('capture','駒取り履歴'),('lmr','履歴＋LMR'),('adaptive','方策なし')]], [153,107,107,144])
p('負の差は最新構成に有利。駒取り履歴との比較は、教師を深くすると平均差が-37.33cpから+4.76cpへ変わった。深さ16では4改善・14同等・3悪化。従来の平均改善を、安定した効果として採用できない。LMRとの差も区間が0をまたぐ。')
p('3秒から5秒へ延ばすと、深さ16では2改善・19同等・0悪化、平均候補差は99.33→71.67cp。ただし同一進行に偏る小標本の感度分析であり、一般的な棋力向上の証明ではない。')
h('5. 変化を生んだ具体例')
p('最新3秒と駒取り履歴3秒の着手評価差は、0-44で+300→+38cp、2-28で-3→-159cp、3-28で+66→-367cp、3-44で-64→-409cpへ変化した。ここでは正の値が最新構成に有利。','small')
p('以前選んだ7局面の教師スコアは全件再現した。今回の変更はその記録の誤りではなく、調べる範囲を全局面へ広げたことで生じた。','small')

page();title('指定された評価軸との対応')
p('以下の対局・探索深さは前回の測定値であり、今回は棋譜・読み筋の監査を行った。今回の新規測定と混ぜて、対局数や標本数を増やして数えない。')
table(['評価軸','現在確認できる結果','判断'],[
 ['1. やねうら王戦','最新0勝6敗、駒取り履歴0勝6敗。双方1秒。各方式は生成開始4局＋平手初期2局。','固定旧版に全敗。対抗できる棋力は未確認。'],
 ['2. 既存手法戦','最新対駒取り履歴7勝5敗、対LMR7勝5敗。駒取り履歴対従来PVS9勝3敗。内部比較は200ms/手。','最新の優位は未確定。駒取り履歴には支持する観測。'],
 ['3. 実行時間','今回216探索で、静的評価cacheの探索時間8.19%短縮。起動込み5.48%短縮。','同じ探索結果を保つ高速化は再現。'],
 ['4. 読み深さ','前回1秒: 最新の最大到達25.67手、PV7.00手。駒取り履歴は12.67手、PV5.79手。','最深の一本と全候補の確認深さは異なる。'],
 ['5. 探索ノード','前回1秒: 最新568,235、駒取り履歴598,380ノード/探索。今回速度試験は各10万ノード。','探索木が違う場合、少ないほど良いとは言えない。'],
 ['6. 補助指標','PV合法性、時間超過、初回未完了、候補差、教師深さへの感度、再現性。','深い教師でも変動が大きい局面を発見。'],
], [83,253,175])
h('6. 成果として維持するもの、留保するもの')
p('維持：NNUE互換推論と静的評価cacheなど、同値性と速度が確認された実装改善。棋譜・候補・各手の探索量を保存し、結果を独立したルール実装で再生する実験基盤。駒取り履歴は対局の有効性を支持する結果がある。')
p('留保：最新選択的探索がPVSやLMRより確実に強い、根方策学習の効果が一般化する、浅い教師との一致度が棋力を表す、という主張。最新構成の対駒取り履歴の着手品質は深い教師で再現しなかった。')
p('試験の限界：教師と自作が同じ基礎NNUEを利用。24局面は8進行に由来し、今回の再採点は新しい独立局面での試験ではない。前回の対やねうら王は自作native・相手WASMの実システム比較。最新native版や別評価関数との独立比較は未実施。','small')
h('7. 次に必要な検証')
p('候補ごとの反論発見時刻・静止探索の消費ノードを追い、3-28、3-44等の失敗を説明する。その後、未使用の進行・先後交換・秒単位の対局で比較する。今回の24局面を調整用に使った後は、同じ集合を採用判定用と呼ばない。')

page();title('再現手順と保存記録')
h('8. 実行条件を固定して再開できる')
p('元の研究総括：REPORT-retrospective-20260927.md。元の実験手順：REPRODUCE-retrospective-20260927.md。今回の追試は別の出力ディレクトリに保存し、元結果を上書きしていない。')
p('対象コードはwork/research-summary-20260927の31bc03a。探索ロジックは前回対象v0.20と同じ。新ブランチはwork/verification-resume-20260927。今回追加したのは再測定・集計・報告のスクリプトと記録。')
table(['保存物','役割'],[
 ['protocol.json / environment.json','測定前の条件、乱数・方式順、バイナリ・モデル・候補集合のハッシュ、環境、自己検査結果。'],
 ['speed/','全216探索。方式間の同値性と、前回との対応一致を72ブロックで確認。'],
 ['depth16/ / teacher-usi.jsonl','24根・47候補の深さ16評価と教師の全応答。'],
 ['quality-rescored.csv','前回の384着手に対する深さ12/16の採点。全768行。'],
 ['summary.json / audit.json','候補差、対応比較、速度、区間、前回監査結果。'],
 ['manifest.json / raw-results.tar.gz','成果物のハッシュ一覧と生データ。'],
], [187,324])
h('9. 実行の順序')
for t in ['1. 同ブランチを取得し、make -j4を実行。make testの結果をbuild/resume-selftests.txtへ保存する。',
          '2. 前回raw-results.tar.gzを解析用の別ディレクトリに展開する。',
          '3. V21_PRIORに前回データ、V21_RESUMEに新しい出力先、YANEURAOU_ASSETSに既存評価資材を指定する。',
          '4. node scripts/resume_verification_v21.mjs allを実行する。',
          '5. python3 scripts/summarize_resume_v21.pyで集計する。',
          '6. REPORT_ASSETSとREPORT_OUTPUTを指定し、report_resume_v21.pyで本資料を作る。']:p(t,'small')
p('測定は直列で行う。保存済みの完了ブロックから再開する。条件が変わるとハッシュ照合で停止する。多重実行防止のrun.lockが残る場合は、元プロセスが終了したことを確かめてから取り除く。','small')
h('10. 件数の扱い')
p('前回：48対局・660自作探索・24根の深さ12教師・7根の深さ16診断。今回新規：216自作探索・24根の深さ16教師。新規対局は0。自作探索の測定実行数は合計876だが、今回の216は同じ24局面の速度追試なので、独立標本数は増えていない。')
p('教師の深さ16評価も真の正解ではない。今回の重要な成果は、速さの再現を確かめると同時に、着手品質の改善という解釈が評価条件に依存することを明確にした点にある。')

def footer(c,doc):
    c.setStrokeColor(colors.HexColor('#cbd8df'));c.line(42,804,553,804)
    c.setFont('JP',8);c.setFillColor(MUTED);c.drawString(42,816,'SHOGI SEARCH LAB  |  CONTINUATION VERIFICATION 2026.09.27')
    c.drawString(42,25,'前回記録の監査 + 216探索の追試 + 全24局面の深さ16再採点')
    c.drawRightString(553,25,str(doc.page))
SimpleDocTemplate(str(OUTPUT),pagesize=(595.28,841.89),leftMargin=42,rightMargin=42,topMargin=54,bottomMargin=48,
    title='将棋AI研究 検証再開・追補報告',author='Shogi Search Lab').build(story,onFirstPage=footer,onLaterPages=footer)
(ROOT/'REPORT-verification-resume-20260927.md').write_text('\n'.join(md))
print(OUTPUT)
