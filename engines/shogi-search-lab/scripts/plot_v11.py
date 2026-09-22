"""Export static research figures from recorded measurements."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from ml_nnue import head_score
R=Path(__file__).resolve().parents[1];D=R/'results/v0.11';S=json.loads((D/'summary.json').read_text())
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white','savefig.facecolor':'white'})
fig,axes=plt.subplots(1,3,figsize=(14,5.0),layout='constrained')
z=np.load(R/'results/v0.10/dataset.npz');h=dict(np.load(R/'models/v0.10/anchored50.npz'));m=(z['split']=='test')&~z['checked'];delta=(head_score(z['x'],h)[m]-z['base'][m])*100/90
ax=axes[0];ax.hist(delta,bins=np.arange(-80,116,5),color='#496d8c',edgecolor='white',linewidth=.3);ax.axvline(40,c='#c0613a',ls='--',label='Constant +40 cp');ax.set(title='A. Learned correction',xlabel='Learned minus base evaluation (cp)',ylabel='Positions (previous test set)');ax.legend(frameon=False)
ax=axes[1];q=S['quality']['12000']['ordinaryCp']['comparisons'];keys=['anchored50-base','tempo40-base','anchored50-tempo40'];labs=['Learned - base','+40 - base','Learned - +40']
for i,k in enumerate(keys):
 b=q[k]['deltaGap'];x=b['mean'];lo,hi=b['ci95'];ax.errorbar(x,i,xerr=[[x-lo],[hi-x]],fmt='o',c='#496d8c',capsize=4)
ax.set_yticks(range(3),labs);ax.axvline(0,c='.5',ls='--');ax.set(title='B. New-position choice quality',xlabel='Difference in mean candidate gap (cp)\nLower is better; paired 95% bootstrap CI\n12,000 nodes; 62 positions; 16 trajectories');ax.invert_yaxis()
ax=axes[2];f=S['fallback']['ordinaryCp'];v=[f['oldMeanGap'],f['newMeanGap']];bars=ax.bar(['First legal','Completed child'],v,color=['#9ba8b4','#468376'],width=.6)
for b in bars:ax.text(b.get_x()+b.get_width()/2,b.get_height()+30,f'{b.get_height():.2f}',ha='center')
ax.set_ylim(0,max(v)*1.2);ax.set(title='C. Interrupted-search repair',ylabel='Mean teacher candidate gap (cp)');ax.text(.96,.87,'18 improved / 1 tied / 1 worse\n20 selected historical failures',ha='right',transform=ax.transAxes,fontsize=9)
fig.suptitle('Shogi Search Lab v0.11 | Frozen-model controls and interruption handling',fontsize=14)
for ext in ['png','svg']:fig.savefig(D/f'diagnostic-comparison.{ext}',dpi=170)
plt.close(fig)
if S['matches']==128:
 comps=S['matchComparisons'];fig,ax=plt.subplots(figsize=(10,5),layout='constrained');names={'anchored50':'Learned','tempo40':'+40 cp','base':'Base'};labels=[]
 for i,(key,v) in enumerate(comps.items()):
  level,a,b=key.split('-');labels.append(f"{names[a]} vs {names[b]} | {v['nodes']:,} nodes")
  left=0
  for metric,color,label in [('wins','#468376','Win'),('draws','#b7bec3','Draw'),('losses','#c77b62','Loss'),('unresolved','#e4c984','Unresolved')]:
   count=v[metric];ax.barh(i,count,left=left,color=color,label=label if i==0 else None)
   if count:ax.text(left+count/2,i,str(count),ha='center',va='center',fontsize=10)
   left+=count
 ax.set_yticks(range(len(labels)),labels);ax.invert_yaxis();ax.set_xlabel('Games (paired colors, common starts)');ax.set_title('128 games | Counts from the left-hand model\nUnresolved games are kept separate from draws');ax.legend(ncols=4,loc='upper center',bbox_to_anchor=(.5,-.12),frameon=False)
 for ext in ['png','svg']:fig.savefig(D/f'match-outcomes.{ext}',dpi=170)
 print('Exported both figures')
else:print('Exported diagnostics only; matches still in progress')
