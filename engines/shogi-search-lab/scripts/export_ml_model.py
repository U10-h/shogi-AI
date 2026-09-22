#!/usr/bin/env python3
import argparse,json,numpy as np
from ml_nnue import read_model,export_model
p=argparse.ArgumentParser();p.add_argument('--base',required=True);p.add_argument('--head',required=True);p.add_argument('--output',required=True);a=p.parse_args()
head=dict(np.load(a.head,allow_pickle=False));sha=export_model(read_model(a.base),head,a.output)
print(json.dumps({'output':a.output,'sha256':sha}))
