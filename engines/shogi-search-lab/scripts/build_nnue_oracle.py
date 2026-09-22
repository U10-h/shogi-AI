#!/usr/bin/env python3
"""Build a test-only harness around the pinned upstream inference implementation."""
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
files=['scripts/nnue_oracle.cpp']+['vendor/yaneuraou/'+p for p in [
    'bitboard.cpp','position.cpp','movegen.cpp','types.cpp','eval/evaluate.cpp',
    'eval/evaluate_bona_piece.cpp','eval/nnue/features/k.cpp','eval/nnue/features/p.cpp']]
subprocess.run(['g++','-std=c++17','-O2','-Ivendor/yaneuraou','-DLAB_RULES_ONLY',
    '-DNO_SSE','-DEVAL_NNUE','-DEVAL_NNUE_KP256','-DUSE_EVAL_LIST',
    '-ffunction-sections','-fdata-sections',*files,'-Wl,--gc-sections','-pthread',
    '-o','build/nnue-oracle'],cwd=root,check=True)
