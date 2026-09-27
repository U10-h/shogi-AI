#!/usr/bin/env python3
"""One additional pre-existing failure case; keep the four-position cohort frozen."""
import argparse
import hashlib
import json
from pathlib import Path
from run_phase0_small import atomic, sha
import run_phase0f_stress as base


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('stage',choices=['compare','diagnose'])
    p.add_argument('--out',type=Path,default=base.ROOT/'results/v1.0-phase0f-hard')
    p.add_argument('--base-out',type=Path,default=base.ROOT/'results/v1.0-phase0f')
    args=p.parse_args();out=args.out.resolve()
    inherited=base.freeze(args.base_out.resolve())
    path=base.ROOT/'experiments/phase0f-hard-position.json'
    manifest={'schema':1,'source_base_commit':inherited['source_base_commit'],
              'inherited_manifest':inherited,'positions':json.loads(path.read_text()),
              'additional_source_sha256':{str(Path(__file__).relative_to(base.ROOT)):sha(Path(__file__)),
                                           str(path.relative_to(base.ROOT)):sha(path)},
              'selection_note':'Additional stress case selected after the four-position study, before observing its rerun.'}
    manifest['condition_sha256']=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()
    target=out/'manifest.json'
    if target.exists(): assert json.loads(target.read_text())==manifest
    atomic(target,manifest)
    pos=manifest['positions'][0]
    done=out/f'{args.stage}/{pos["id"]}/complete.json'
    if done.exists():
        r=json.loads(done.read_text());assert r['checked'] and r['condition_sha256']==manifest['condition_sha256']
        print(json.dumps({'stage':args.stage,'new_positions':0}));return
    if args.stage=='diagnose': assert (out/f'compare/{pos["id"]}/complete.json').exists()
    (base.compare if args.stage=='compare' else base.diagnose)(pos,out,manifest)
    print(json.dumps({'stage':args.stage,'new_positions':1,'position':pos['id']}))


if __name__=='__main__':
    main()
