#!/usr/bin/env python3
"""Summarize already-validated, completed searches and games into the report."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'results/v0.7'
summary=json.loads((OUT/'summary.json').read_text())
matches=json.loads((OUT/'matches.json').read_text())
assert matches['status']=='finished' and len(matches['games'])==12
assert all(g['status']=='finished' for g in matches['games'])
parts=['各条件は対局開始前に固定した。勝敗の評価値による途中打ち切りは行わず、詰み・反復・手数上限まで進めた。',
 '| 比較 | 1手の探索予算 | 位置評価版／従来版の成績 |',
 '|---|---|---|']
for k,name,budget in [('positional_vs_material','位置評価版 対 従来版','双方300ms'),('material_vs_yaneuraou','従来版 対 やねうら王','双方3000ms'),('positional_vs_yaneuraou','位置評価版 対 やねうら王','双方3000ms')]:
    s=summary['matches'][k]
    parts.append(f"| {name} | {budget} | {s['wins']}勝{s['losses']}敗{s['draws']}分・未決着{s['unresolved']} |")
parts += ['',
    '従来版との比較は4種類の開始手順で先後を交換した8局。やねうら王との比較は、そのうち角交換後の同じ開始手順から、従来版・位置評価版それぞれ先後交換の2局ずつ。初期局面から始めた前回v0.6とは条件が違うため、手数や結果を直接比較しない。','',
    '探索は双方1スレッド、定跡・先読みなし、MultiPV 1。自作側は毎手新しいプロセスを起動する。探索予算のほかに起動・盤面設定・通信の壁時計時間がかかる。入玉宣言は無効。上限は対従来版200手、対やねうら王160手（開始手順の後から数える）。手数上限による未決着があれば引き分けとは分けて数える。','',
    '8局は小規模なスクリーニングであり、一般的な勝率やElo・段級位の推定には使わない。やねうら王相手の勝敗も併記し、同条件での候補評価改善と、強豪エンジンに勝てることを区別する。','',
    '| 対局ID | 追加手数 | 勝者 | 終了理由 |','|---|---:|---|---|']
for g in matches['games']:
    winner=g['result']['winner']
    engine='未決着' if g['result'].get('unresolved') else '引き分け' if winner is None else g['candidate'] if winner==g['candidateSide'] else g['opponent']
    parts.append(f"| {g['id']} | {len(g['moves'])} | {engine} | {g['result']['reason']} |")
report=ROOT/'REPORT-v0.7.md';s=report.read_text()
assert '<!-- MATCH_RESULTS -->' in s
report.write_text(s.replace('<!-- MATCH_RESULTS -->','\n\n'.join(parts[:1])+'\n\n'+'\n'.join(parts[1:])))
verification=dict(allGamesFinished=True,games=len(matches['games']),
    moves=sum(len(g['moves']) for g in matches['games']),
    pvLines=sum(bool(m['analysis'].get('pv')) for g in matches['games'] for m in g['moves']),
    pvMoves=sum(len(m['analysis'].get('pv',[])) for g in matches['games'] for m in g['moves']),
    kifFiles=sum((OUT/(g['id']+'.kif')).exists() for g in matches['games']),
    checks='match_eval.mjs checks each move and PV against tsshogi, no-legal-move terminals, and every KIF round-trip before marking the run finished.')
assert verification['kifFiles']==12
(OUT/'match-verification.json').write_text(json.dumps(verification,indent=2))
print(json.dumps(verification,indent=2))
