#!/usr/bin/env python3
"""Rebuild the pinned opponent natively; keep all generated files under build/."""
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUT = ROOT / 'build/phase0'
ARCHIVE = REPO / 'dist/vendor/yaneuraou/corresponding-source.zip'
ARCHIVE_SHA = '15e6ac502d282adec7b9e17609b7e7265adfe56c08cd498be0f3a3351b8ea227'
MODEL_SHA = 'cf7645f64bf6baa5c74612799ce562752f7985923b1f0fc2e6092c998ed867f9'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    if sha(ARCHIVE) != ARCHIVE_SHA:
        raise SystemExit('Pinned source archive checksum mismatch')
    OUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ARCHIVE) as z:
        for name in z.namelist():
            p = Path(name)
            if p.is_absolute() or '..' in p.parts:
                raise ValueError('Unsafe archive path')
        z.extractall(OUT / 'upstream')
    src = next((OUT / 'upstream').iterdir()) / 'source'
    # Restore the original blocking native USI entry point, disabled by the WASM fork.
    p = src / 'main.cpp'
    s = p.read_text(encoding='utf-8-sig')
    for before, after in [('// USI::loop(argc, argv);', 'USI::loop(argc, argv);'),
                          ('// Threads.set(0);', 'Threads.set(0);')]:
        assert s.count(before) == 1
        s = s.replace(before, after)
    p.write_text(s)
    p = src / 'usi.cpp'
    s = p.read_text(encoding='utf-8-sig')
    assert s.count('#include <emscripten.h>') == 1
    s = s.replace('#include <emscripten.h>', '#define EMSCRIPTEN_KEEPALIVE')
    before = 'else if (token == "eval") cout << "eval = " << Eval::compute_eval(pos) << endl;'
    assert s.count(before) == 1
    # Read-only telemetry after bestmove: do not infer completed depth from the last PV line.
    s = s.replace(before, '''else if (token == "phase0stats") {
            Threads.main()->wait_for_search_finished();
            cout << "phase0stats completed_depth " << Threads.main()->completedDepth
                 << " nodes " << Threads.nodes_searched() << endl;
        }
        ''' + before)
    p.write_text(s)
    model = src / 'eval/nn.bin'
    assert sha(model) == MODEL_SHA
    # Bound compilation to two processes; no network, PGO or training.
    cmd = ['make', '-j2', 'normal', 'COMPILER=g++', 'TARGET_CPU=AVX2',
           'YANEURAOU_EDITION=YANEURAOU_ENGINE_NNUE_KP256', 'LTOFLAGS=',
           'EXTRA_CPPFLAGS=-pthread', 'EXTRA_LDFLAGS=-pthread']
    with (OUT / 'build-native.log').open('w') as log:
        subprocess.run(cmd, cwd=src, stdout=log, stderr=subprocess.STDOUT,
                       check=True, timeout=180)
    binary = src / 'YaneuraOu-by-gcc'
    manifest = {'archive_sha256': ARCHIVE_SHA, 'model_sha256': MODEL_SHA,
                'upstream_commit': 'b2defb6d255ea44b3fead30e13f28b96e0ab0cc7',
                'binary_sha256': sha(binary), 'command': cmd,
                'compiler': subprocess.check_output(['g++', '--version'], text=True).splitlines()[0],
                'native_changes': ['Restore USI::loop and Threads.set(0) in main.cpp',
                                   'Replace Emscripten annotation include by empty macro',
                                   'Add read-only phase0stats USI command for completedDepth and final nodes'],
                'patched_sources': {n: sha(src/n) for n in ['main.cpp', 'usi.cpp']}}
    (OUT / 'native-build.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()
