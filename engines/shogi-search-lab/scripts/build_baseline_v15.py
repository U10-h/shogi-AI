#!/usr/bin/env python3
"""Rebuild the attached v0.14 source in isolation; no git access needed."""
from pathlib import Path
import shutil,subprocess,tempfile
R=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='shogi-v14-') as td:
    work=Path(td)
    shutil.copytree(R/'src',work/'src')
    for p in (R/'checkpoints/v0.14/src').glob('*'):shutil.copy2(p,work/'src'/p.name)
    shutil.copy2(R/'checkpoints/v0.14/Makefile',work/'Makefile')
    (work/'vendor').symlink_to(R/'vendor',target_is_directory=True)
    subprocess.run(['make','-j4'],cwd=work,check=True)
    (R/'build').mkdir(exist_ok=True)
    shutil.copy2(work/'build/shogi-lab',R/'build/shogi-lab-v0.14')
print(R/'build/shogi-lab-v0.14')
