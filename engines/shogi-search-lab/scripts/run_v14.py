#!/usr/bin/env python3
"""Launch the v0.14 variants without typing long feature lists.

Usage: python3 scripts/run_v14.py [capture|hybrid|selective|base] [engine options]
Set YANEURAOU_ASSETS to the verified opponent/evaluation asset directory.
Add --usi to connect a GUI, or --depth 16 --iterative --time-ms 1000 to analyze.
"""
import os,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1]
args=sys.argv[1:];variant=args.pop(0) if args and not args[0].startswith('--') else 'capture'
if variant not in ['base','capture','hybrid','selective']:raise SystemExit('Variant must be base|capture|hybrid|selective')
assets=Path(os.environ.get('YANEURAOU_ASSETS',str(R.parent/'opponent')))
model=assets/'yaneuraou.data';binary=R/'build/shogi-lab'
if not binary.is_file():raise SystemExit('Run make -j2 first.')
if not model.is_file():raise SystemExit('Run scripts/fetch_opponent.py, then set YANEURAOU_ASSETS.')
features='tt,history,killer,counter,mate-distance,qsearch'
if variant!='base':features+=',capture-history'
if variant=='selective':features+=',lmr'
cmd=[str(binary),'--usi' if '--usi' in args else '--advanced','--eval','nnue','--eval-model',str(model),'--features',features]
if variant=='hybrid':cmd+=['--policy-model',str(R/'models/v0.14/quiet-policy.txt'),'--policy-scale','1']
cmd += [a for a in args if a!='--usi']
os.execv(str(binary),cmd)
