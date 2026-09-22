#!/usr/bin/env python3
import csv,json,os
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V19_RESULTS',R/'results/v0.19'))
s=json.loads((D/'summary.json').read_text());rows=list(csv.DictReader((D/'quality.csv').open()))
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,ax=plt.subplots(1,3,figsize=(14,4.4),layout='constrained')
selected=json.loads((D/'selection.json').read_text())['selected']
colors={'base':'#21618c',selected:'#cb6d32'};labels={'base':'v0.18 baseline',selected:'v0.19 '+selected}
for name in ['base',selected]:
 qs=sorted([r for r in s['quality'] if r['variant']==name],key=lambda r:r['ms'])
 ax[0].plot([r['ms']/1000 for r in qs],[r['meanGap'] for r in qs],'o-' if name=='base' else 's--',color=colors[name],label=labels[name],linewidth=2)
ax[0].set(xlabel='Search budget per move (s)',ylabel='Mean teacher candidate gap (cp)',title='A. Choice quality vs search time',xticks=[1,3,5],ylim=(0,None));ax[0].legend(fontsize=8)
metrics=json.loads((D/'implementation-metrics.json').read_text())
dev=[x for x in metrics['development'] if x['variant']!='root']
ax[1].barh([x['variant'] for x in dev],[x['meanEntries'] for x in dev],color='#718d99')
ax[1].set(xlabel='Mean cached entries (20 known roots)',title='B. Cache occupancy at 500ms',xlim=(0,115000))
ax[1].invert_yaxis()
for i,x in enumerate(dev):ax[1].text(x['meanEntries']+1200,i,f"{x['meanEntries']:,.0f}",va='center',fontsize=8)
for index,g in enumerate(s['games']):
 ax[2].barh(index,g['totalPlies'],color=colors[g['variant']],alpha=.8)
 if g['firstSustained500Ply'] is not None:ax[2].plot(g['firstSustained500Ply'],index,'|',color='black',markersize=13,markeredgewidth=2)
 ax[2].text(g['totalPlies']+1,index,str(g['totalPlies']),va='center',fontsize=8)
ax[2].set(yticks=range(len(s['games'])),yticklabels=[f"{g['variant']} / {g['ourMs']/1000:g}s / {g['side']}" for g in s['games']],xlabel='Plies from start',title='C. Matches vs YaneuraOu (2s)');ax[2].invert_yaxis()
ax[2].set_xlim(0,max(g['totalPlies'] for g in s['games'])*1.14)
for a in ax:a.grid(axis='x',alpha=.15)
fig.suptitle('Shogi Search Lab v0.19 | 12 roots from 4 trajectories; 8 matches',fontsize=13)
fig.supxlabel('Teacher depth-12 common-candidate gap is approximate. Black markers: first of three observations at least 500cp behind.',fontsize=9)
fig.savefig(D/'overview.png',dpi=170)
