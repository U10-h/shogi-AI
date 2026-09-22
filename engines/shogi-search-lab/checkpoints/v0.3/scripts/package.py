#!/usr/bin/env python3
"""Package source, licenses, and recorded results; exclude compiler outputs."""
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT.parent / "shogi-search-lab.zip"
files = sorted(p for p in ROOT.rglob("*") if p.is_file()
               and not any(part in {"build", ".git", "__pycache__"} for part in p.relative_to(ROOT).parts)
               and p.name != "MANIFEST.json")
manifest = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(ROOT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
with zipfile.ZipFile(TARGET, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for p in files + [ROOT / "MANIFEST.json"]:
        archive.write(p, Path("shogi-search-lab") / p.relative_to(ROOT))
with zipfile.ZipFile(TARGET) as archive:
    assert archive.testzip() is None
print(json.dumps({"path": str(TARGET), "bytes": TARGET.stat().st_size,
                  "sha256": hashlib.sha256(TARGET.read_bytes()).hexdigest(), "files": len(files) + 1}))
