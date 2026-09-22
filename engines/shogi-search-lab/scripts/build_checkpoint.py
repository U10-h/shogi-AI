#!/usr/bin/env python3
"""Build an archived lab version against the unchanged vendored rules."""
import argparse,shutil,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('version',choices=['v0.6','v0.7']);args=p.parse_args()
checkpoint=root/'checkpoints'/args.version
with tempfile.TemporaryDirectory(prefix='shogi-checkpoint-') as d:
 target=Path(d);shutil.copytree(checkpoint/'src',target/'src');shutil.copy2(checkpoint/'Makefile',target/'Makefile')
 (target/'vendor').symlink_to(root/'vendor',target_is_directory=True)
 subprocess.run(['make','-j2'],cwd=target,check=True)
 destination=root/'build'/('shogi-lab-'+args.version);destination.parent.mkdir(exist_ok=True)
 shutil.copy2(target/'build/shogi-lab',destination)
 print(destination)
