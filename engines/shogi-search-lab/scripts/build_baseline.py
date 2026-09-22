#!/usr/bin/env python3
"""Rebuild the saved v0.6 source with the same rules code and compiler options."""
import shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
stage=ROOT/'build/baseline-source';stage.mkdir(parents=True,exist_ok=True)
shutil.copytree(ROOT/'checkpoints/v0.6/src',stage/'src',dirs_exist_ok=True)
shutil.copy2(ROOT/'checkpoints/v0.6/Makefile',stage/'Makefile')
if not (stage/'vendor').exists():(stage/'vendor').symlink_to(ROOT/'vendor',target_is_directory=True)
subprocess.run(['make','-j2'],cwd=stage,check=True)
shutil.copy2(stage/'build/shogi-lab',ROOT/'build/shogi-lab-v0.6')
