#!/usr/bin/env python3
"""Build standard and pilot searches into one pinned native YaneuraOu binary."""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import zipfile
from pathlib import Path
import build_phase0_native as base

ROOT = base.ROOT
OUT = ROOT/'build/phase0b'

def replace(path, before, after):
    s = path.read_text(encoding='utf-8-sig')
    assert s.count(before) == 1, (path, before)
    path.write_text(s.replace(before, after))

def main():
    assert base.sha(base.ARCHIVE) == base.ARCHIVE_SHA
    OUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(base.ARCHIVE) as z:
        for name in z.namelist():
            p = Path(name)
            if p.is_absolute() or '..' in p.parts:
                raise RuntimeError('Invalid pinned archive path')
        z.extractall(OUT/'upstream')
    src = next((OUT/'upstream').iterdir())/'source'
    replace(src/'main.cpp', '// USI::loop(argc, argv);', 'USI::loop(argc, argv);')
    replace(src/'main.cpp', '// Threads.set(0);', 'Threads.set(0);')
    replace(src/'usi.cpp', '#include <emscripten.h>', '#define EMSCRIPTEN_KEEPALIVE')
    before = 'else if (token == "eval") cout << "eval = " << Eval::compute_eval(pos) << endl;'
    replace(src/'usi.cpp', before, '''else if (token == "phase0stats") {
            Threads.main()->wait_for_search_finished();
            cout << "phase0stats completed_depth " << Threads.main()->completedDepth
                 << " nodes " << Threads.nodes_searched() << endl;
        }
        ''' + before)
    search = src/'engine/yaneuraou-engine/yaneuraou-search.cpp'
    replace(search, 'book.init(o);', '''book.init(o);
    o["Phase0Search"] << Option(std::vector<std::string>{"standard", "alphabeta", "minimax"}, "standard");
    o["Phase0Audit"] << Option(false);''')
    replace(search, 'void MainThread::search()\n{', '''void phase0b_search(MainThread&);
void MainThread::search()
{
    if (!(Options["Phase0Search"] == "standard")) { phase0b_search(*this); return; }''')
    shutil.copyfile(ROOT/'native/phase0b_search.cpp', src/'phase0b_search.cpp')
    replace(src/'Makefile', 'OBJECTS  = $(addprefix', 'SOURCES += phase0b_search.cpp\n\nOBJECTS  = $(addprefix')
    assert base.sha(src/'eval/nn.bin') == base.MODEL_SHA
    cmd = ['make', '-j2', 'normal', 'COMPILER=g++', 'TARGET_CPU=AVX2',
           'YANEURAOU_EDITION=YANEURAOU_ENGINE_NNUE_KP256', 'LTOFLAGS=',
           'EXTRA_CPPFLAGS=-pthread -I.', 'EXTRA_LDFLAGS=-pthread']
    with (OUT/'build.log').open('w') as log:
        p = subprocess.Popen(cmd, cwd=src, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = p.wait(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(p.pid, signal.SIGKILL); p.wait(); raise
        if code:
            raise SystemExit('Build failed: see build/phase0b/build.log')
    files = ['main.cpp', 'usi.cpp', 'Makefile', 'engine/yaneuraou-engine/yaneuraou-search.cpp', 'phase0b_search.cpp']
    manifest = {'archive_sha256': base.ARCHIVE_SHA, 'model_sha256': base.MODEL_SHA,
                'upstream_commit': 'b2defb6d255ea44b3fead30e13f28b96e0ab0cc7',
                'binary_sha256': base.sha(src/'YaneuraOu-by-gcc'), 'command': cmd,
                'compiler': subprocess.check_output(['g++', '--version'], text=True).splitlines()[0],
                'patched_sources': {f: base.sha(src/f) for f in files},
                'shared': ['Position', 'MoveList<LEGAL_ALL>', 'Eval::evaluate', 'NNUE weights', 'USI runtime', 'Thread nodes counter'],
                'pilot_limits': {'depth': 3, 'nodes': 400000, 'milliseconds': 3000, 'threads': 1},
                'pilot_omits': ['TT', 'qsearch', 'LMR', 'learned ordering', 'pruning beyond alpha-beta']}
    (OUT/'build.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest, indent=2))

if __name__ == '__main__':
    main()
