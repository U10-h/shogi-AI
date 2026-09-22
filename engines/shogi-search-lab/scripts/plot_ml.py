#!/usr/bin/env python3
"""Standalone, reproducible research figure from recorded measurements."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'results/v0.10'
training=[json.loads((D/('training-'+s+'.json')).read_text()) for s in ['naive','rebuild']]
quality=json.loads((D/'test-quality-summary.json').read_text());static=json.loads((D/'static-test.json').read_text())
plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'#f6f8fb','axes.facecolor':'white'})
fig,axes=plt.subplots(2,2,figsize=(14,9));fig.subplots_adjust(left=.08,right=.97,bottom=.13,top=.89,wspace=.27,hspace=.44)
colors={'naive':'#dd7846','anchored25':'#83a8af','anchored50':'#147b88'}
ax=axes[0,0]
ax.axhline(training[0]['baselineValidation']['maeCp'],color='#606d80',ls='--',label='Original')
for stage in training:
 for config in stage['configs']:
  n=config['config']['name'];h=config['history'];ax.plot([x['epoch'] for x in h],[x['validation']['maeCp'] for x in h],label=n,color=colors[n],lw=2)
ax.set(title='Validation: static fitting alone can mislead',xlabel='Epoch',ylabel='Teacher-label MAE (cp; lower is better)');ax.legend(fontsize=9)
ax=axes[0,1];values=[static[n]['maeCp'] for n in ['base','candidate']]
ax.bar(['Original','Rebuilt head'],values,color=['#606d80','#147b88'],width=.5)
for i,v in enumerate(values):ax.text(i,v+12,f'{v:.1f}',ha='center',fontweight='bold')
ax.set(ylim=(0,830),title='Held-out static evaluation: 8,827 positions',ylabel='MAE (cp; lower is better)')
ax.text(.5,.88,f'{(values[0]-values[1])/values[0]*100:.2f}% lower MAE',transform=ax.transAxes,ha='center',color='#147b88')
ax=axes[1,0];rows=[json.loads(p.read_text()) for p in sorted((D/'quality-test').glob('*.json'))];rows=[r for r in rows if r['ms']==1000]
diff=[]
for r in rows:
 a=next(x for x in r['runs'] if x['variant']=='base');b=next(x for x in r['runs'] if x['variant']=='anchored50');diff.append(a['teacherGapCp']-b['teacherGapCp'])
ax.axhline(0,color='#8b94a3',lw=1);ax.bar(np.arange(96),diff,color=['#147b88' if x>=0 else '#c75548' for x in diff],width=.85)
ax.set(title='Held-out 1-second search: all 96 roots',xlabel='Fixed test root index',ylabel='Gap reduction (cp; positive is better)')
ax.text(.02,.95,'5 better / 87 equal / 4 worse',transform=ax.transAxes,va='top',fontsize=10)
ax=axes[1,1]
for i,ms in enumerate(['1000','3000']):
 r=quality[ms]['models']['anchored50'];mean=-r['meanPairedDeltaCp'];lo,hi=[-x if x else 0. for x in r['pairedGameBootstrap95'][::-1]]
 ax.errorbar(mean,i,xerr=[[mean-lo],[hi-mean]],fmt='o',color='#147b88',capsize=5,ms=8)
 ax.annotate(f'{mean:.1f} cp  [{lo:.1f}, {hi:.1f}]',(mean,i),xytext=(0,15),textcoords='offset points',ha='center',fontsize=10)
ax.axvline(0,color='#8b94a3',ls='--');ax.set(yticks=[0,1],yticklabels=['1s / 96 roots','3s / 24 roots'],ylim=(-.5,1.6),title='Search gain: mean and cluster bootstrap 95%',xlabel='Gap reduction (cp; positive is better)')
fig.suptitle('Shogi evaluation learning: fit, reconstruct, then test',fontsize=20,fontweight='bold',x=.08,ha='left')
fig.text(.08,.045,'Frozen pretrained features; 1,089 trainable head parameters. Final test was not used to tune weights.\nThe 3s gain comes from one root also present in the 1s set. Teacher scores are diagnostic, not Elo or proven move values.',fontsize=10,color='#46546a')
for ext in ['png','svg']:fig.savefig(D/('learning-evaluation.'+ext),dpi=160)
print(D/'learning-evaluation.png')
