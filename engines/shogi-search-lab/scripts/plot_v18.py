#!/usr/bin/env python3
import csv,json,os
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=Path(__file__).resolve().parents[1];D=Path(os.environ.get('V18_RESULTS',R/'results/v0.18'))
s=json.loads((D/'summary.json').read_text());rows=list(csv.DictReader((D/'quality.csv').open()))
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,ax=plt.subplots(1,3,figsize=(14,4.4),layout='constrained')
colors={'root':'#21618c','cache':'#cb6d32'};labels={'root':'Root policy (v0.17)','cache':'With qsearch cache'}
for name in ['root','cache']:
 qs=sorted([r for r in s['quality'] if r['variant']==name],key=lambda r:r['ms'])
 ax[0].plot([r['ms']/1000 for r in qs],[r['meanGap'] for r in qs],'o-',color=colors[name],label=labels[name],linewidth=2)
ax[0].set(xlabel='Search budget per move (s)',ylabel='Mean teacher candidate gap (cp)',title='A. More time improved choices',xticks=[1,3,5,10],ylim=(0,None));ax[0].legend(fontsize=8)
for root in sorted({r['root'] for r in rows}):
 rs=sorted([r for r in rows if r['root']==root and r['variant']=='root'],key=lambda r:int(r['ms']))
 ax[1].plot([int(r['ms'])/1000 for r in rs],[float(r['teacherGap']) for r in rs],'o-',alpha=.5,linewidth=1)
ax[1].set(xlabel='Search budget per move (s)',ylabel='Teacher candidate gap (cp)',title='B. Individual roots, baseline',xticks=[1,3,5,10],ylim=(0,None))
for index,g in enumerate(s['games']):
 ax[2].barh(index,g['totalPlies'],color=colors[g['variant']],alpha=.8)
 if g['firstSustained500Ply'] is not None:ax[2].plot(g['firstSustained500Ply'],index,'|',color='black',markersize=13,markeredgewidth=2)
 ax[2].text(g['totalPlies']+1,index,str(g['totalPlies']),va='center',fontsize=8)
ax[2].set(yticks=range(len(s['games'])),yticklabels=[f"{g['variant']} / {g['ourMs']/1000:g}s / {g['side']}" for g in s['games']],xlabel='Plies from start',title='C. Matches vs YaneuraOu (2s)');ax[2].invert_yaxis()
ax[2].set_xlim(0,max(g['totalPlies'] for g in s['games'])*1.14)
for a in ax:a.grid(axis='x',alpha=.15)
fig.suptitle('Shogi Search Lab v0.18 | 12 roots from 4 trajectories; 8 matches',fontsize=13)
fig.supxlabel('Teacher depth-12 common-candidate gap is approximate. Black markers: first of three observations at least 500cp behind.',fontsize=9)
fig.savefig(D/'overview.png',dpi=170)
