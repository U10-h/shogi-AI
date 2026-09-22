import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const lab=resolve(process.argv[2]||'/workspace/scratch/370ee491dc57/project/shogi-search-lab');
const current=JSON.parse(readFileSync('dist/arena-data.json','utf8'));
const match=JSON.parse(readFileSync(lab+'/results/v0.6/arena-labelled.json','utf8'));
const diagnosis=JSON.parse(readFileSync(lab+'/results/v0.6/diagnosis.json','utf8'));
if(match.status!=='finished'||diagnosis.status!=='finished')throw Error('Experiment incomplete');
mkdirSync('docs/arena/v0.6',{recursive:true});
const historical=current.games.filter(g=>!g.id.startsWith('v05-')).map(g=>({...g,labVersion:g.labVersion||'0.4'}));
const additions=match.games.map(g=>{
 const notes=diagnosis.rows.filter(r=>r.game===g.id).map(r=>({ply:r.ply,title:g.moves[r.ply-1].label+'：候補間の評価差'+r.played.teacherGap+'点'}));
 copyFileSync(lab+'/results/v0.6/'+g.id+'.kif','docs/arena/v05-'+g.id+'.kif');
 return {...g,id:'v05-'+g.id,review:notes,reviewNote:'ボタンで実戦の手に移動します。評価差は、やねうら王の深さ12で候補を比較した推定値です。自作AIの駒得評価とは尺度が異なります。差0でも最善手の証明ではありません。'};
});
const data={...match,games:[...additions,...historical],batches:{v05:match.settings,v04:current.batches?.v04||current.settings},
 review:{summary:'今回の4局は自作AIが0勝4敗。枝刈り追加で平均完了深さは増えましたが、12件の再解析で選択手の改善は確認できませんでした。駒の配置や玉の安全を学習する評価関数が、次の優先課題です。'}};
writeFileSync('dist/arena-data.json',JSON.stringify(data,null,2));
for(const file of ['verification.json','diagnosis-verification.json','environment.json','frozen-protocol.json','diagnosis-plan.json','opponent-assets.json'])copyFileSync(lab+'/results/v0.6/'+file,'docs/arena/v0.6/'+file);
copyFileSync(lab+'/REPORT-v0.6.md','dist/REPORT-v0.6.md');copyFileSync(lab+'/RESEARCH-v0.6.md','dist/RESEARCH-v0.6.md');
const e=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const refs=[
 ['MMTO／将棋','玉と駒の位置関係を含む評価の学習','https://www.jair.org/index.php/jair/article/view/10871'],
 ['NNUE／将棋','差分計算で学習評価を高速に呼ぶ','https://github.com/ynasu87/nnue/blob/master/docs/nnue.pdf'],
 ['TreeStrap／チェス','探索木の途中の値と上下限を学習へ使う','https://davidstarsilver.wordpress.com/wp-content/uploads/2025/04/bootstrapping-from-game-tree-search.pdf'],
 ['Giraffe／チェス','評価と着手の有望さを学習する','https://arxiv.org/pdf/1509.01549'],
 ['RPS／将棋','実現確率から読む深さを配分する','https://www.nactem.ac.uk/tsuruoka/papers/icga02.pdf'],
 ['ERPS／LOA','確率による浅い読みの戦術見落としを再探索する','https://dke.maastrichtuniversity.nl/m.winands/documents/ERPS.pdf'],
 ['前向き枝刈りの比較／将棋','futility・null move・LMRの効率と精度を比較する（要旨のみ確認）','https://www.sciencedirect.com/science/article/abs/pii/S1875952111000450'],
 ['GHI／チェッカー・囲碁','履歴に依存する探索結果を安全に再利用する','https://cdn.aaai.org/AAAI/2004/AAAI04-102.pdf']
];
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>実戦から見えた改善点 — 中飛車研究室</title><link rel="icon" href="./icon.svg"><link rel="stylesheet" href="./arena.css"><style>article{max-width:900px;margin:auto;padding:28px 20px 70px;line-height:1.9}h1{font-size:1.9rem;line-height:1.4}h2{font-size:1.25rem;margin-top:32px}.paper-table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.93rem}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #d5ded7}th{white-space:nowrap}.finding{padding:18px 22px;background:#edf3e9;border-radius:12px}a{color:#17443e}code{background:#e9eee8;padding:2px 5px;border-radius:4px}.small{font-size:.9rem;color:#53655f}</style><article><a href="./arena.html">← 対局を観戦する</a><p class="eyebrow">2026.09.21 · EXPERIMENT</p><h1>探索を深くしても、<br>選ぶ手は良くなるか。</h1><p class="finding"><strong>自作AIは0勝4敗でした。</strong>枝刈りを追加すると完了深さは増えましたが、今回の12件では手の質の改善を確認できませんでした。次は、駒得に加えて駒の配置や玉の安全を学習する評価を優先します。</p><h2>双方1手3秒、先後を交換した4局</h2><div class="paper-table"><table><thead><tr><th>設定</th><th>自作AIの手番</th><th>結果</th></tr></thead><tbody>${match.games.map(g=>`<tr><td>${e(g.preset)}</td><td>${g.labSide==='black'?'先手':'後手'}</td><td>${g.moves.length}手・詰みで負け</td></tr>`).join('')}</tbody></table></div><p>tacticalは静止探索を追加した設定。selectiveはさらにLMR・検証付きnull・futility・王手延長を追加した設定です。評価関数はどちらも駒得のみです。</p><p class="small">相手はやねうら王NNUE KP256 6.03、2019年の軽量評価関数です。最新の大会版ではありません。各1スレッド、定跡・先読みなし。時間は予算方式で、厳密な切れ負け判定はしていません。少数対局のためEloや段級位は推定できません。</p><h2>12件を同じ条件で読み直した結果</h2><p>各棋譜の自作側3・7・11回目の手番を抽出。12件は重複を除くと10局面です。4設定を各3秒で探索し、選ばれた候補を同じやねうら王の深さ12で比較しました。</p><div class="paper-table"><table><thead><tr><th>設定</th><th>平均完了深さ</th><th>候補間の評価差・平均</th></tr></thead><tbody><tr><td>tactical</td><td>5.58</td><td>477.2</td></tr><tr><td>selective</td><td>6.75</td><td>487.1</td></tr><tr><td>tactical＋王手延長</td><td>5.33</td><td>477.2</td></tr><tr><td>tactical＋futility</td><td>5.83</td><td>487.1</td></tr></tbody></table></div><p>評価差は小さい方がよい指標です。selectiveは11件でtacticalと同じ手を選び、残る1件は評価が悪化しました。深さの増加だけを棋力向上とは判断しません。</p><p class="small">候補集合内での教師の推定値であり、真の勝率や最善手の証明ではありません。集合が1手だけなら差は0になります。異なるエンジンの評価値は引き算していません。</p><h2>序盤の弱点が共通していた</h2><p>先手5手目の<code>1六香</code>は4設定とも選びましたが、教師評価では<code>7八金</code>より493点低い結果でした。駒得評価はどちらも0付近です。現状の評価には、玉の安全や駒の連携を表す情報がありません。</p><p>これは評価の学習を優先する根拠になります。ただし、評価関数だけを交換した対局はまだ行っていないため、敗因を一つに確定したわけではありません。</p><h2>改善へつながる8件の文献</h2><p>評価関数と学習に関する4件を新たに読み、既存の探索研究4件と結びつけました。MMTO・NNUE・TreeStrapなどの学習機構は、今回の自作AIへまだ導入していません。</p><div class="paper-table"><table><thead><tr><th>文献</th><th>検討する改善</th></tr></thead><tbody>${refs.map(([name,idea,url])=>`<tr><td><a href="${e(url)}">${e(name)}</a></td><td>${e(idea)}</td></tr>`).join('')}</tbody></table></div><h2>棋譜と再現データ</h2><p>実戦234着手と読み筋1619手、再解析の読み筋521手を独立した将棋ルール実装で確認し、4局の終局が詰みであることも検証しました。</p><p><a href="./arena.html">盤面と読み筋を観戦</a> · <a href="./REPORT-v0.6.md" download>詳しい実験報告</a> · <a href="./RESEARCH-v0.6.md" download>文献と実装案</a> · <a href="./search-lab-v0.6.zip" download>探索ソース・全棋譜・測定ログ</a></p></article></html>`;
writeFileSync('dist/arena-research.html',html);
console.log('Imported four verified games and research report; preserved '+historical.length+' historical games.');
