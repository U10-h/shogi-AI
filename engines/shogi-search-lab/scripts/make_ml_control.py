#!/usr/bin/env python3
"""Predeclared +40cp head-bias control; leaves every other parameter unchanged."""
import json,os
from pathlib import Path
from ml_nnue import read_model,write_head,export_model
ROOT=Path(__file__).resolve().parents[1]
base=read_model(Path(os.environ['YANEURAOU_ASSETS'])/'yaneuraou.data')
head={k:base[k].copy() for k in ['w2','b2','w3','b3']}
head['b3']+=576 # 36 raw points * 16; raw pawn=90, cp pawn=100
write_head(ROOT/'models/v0.10/tempo40.npz',head)
sha=export_model(base,head,ROOT/'build/models/v0.10/tempo40.nnue')
print(json.dumps({'control':'tempo40','rawBiasIncrement':576,'modelSha256':sha}))
