#!/usr/bin/env python3
"""fast: exact speedups; lmr/history: experimental selective alternatives."""
import os,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1]
args=sys.argv[1:];name=args.pop(0) if args and not args[0].startswith('--') else 'fast'
if name not in ['fast','lmr','history']:raise SystemExit('Variant: fast|lmr|history')
model=Path(os.environ.get('YANEURAOU_ASSETS',R.parent/'opponent'))/'yaneuraou.data'
binary=R/'build/shogi-lab'
if not binary.is_file():raise SystemExit('Run make -j4 first.')
if not model.is_file():raise SystemExit('Run scripts/fetch_opponent.py and set YANEURAOU_ASSETS.')
features='tt,history,killer,counter,mate-distance,qsearch,capture-history'
if name=='lmr':features+=',lmr'
if name=='history':features+=',history-lmr'
cmd=[str(binary),'--usi' if '--usi' in args else '--advanced','--eval','nnue','--eval-model',str(model),'--features',features]
cmd.extend(a for a in args if a!='--usi');os.execv(str(binary),cmd)
