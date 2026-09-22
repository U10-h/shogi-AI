#!/usr/bin/env python3
"""Build the exact v0.12 reference from unchanged current sources plus four saved files."""
import pathlib,shutil,subprocess,tempfile
R=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='shogi-v012-reference-') as d:
 p=pathlib.Path(d);shutil.copytree(R/'src',p/'src');shutil.copy2(R/'Makefile',p/'Makefile')
 for f in (R/'checkpoints/v0.12/src').glob('*'):shutil.copy2(f,p/'src'/f.name)
 (p/'vendor').symlink_to(R/'vendor',target_is_directory=True)
 subprocess.run(['make','-j4'],cwd=p,check=True)
 shutil.copy2(p/'build/shogi-lab',R/'build/shogi-lab-v0.12-rebuilt')
print(R/'build/shogi-lab-v0.12-rebuilt')
