#!/usr/bin/env python3
"""Fetch the pinned historical WASM opponent; never substitutes a newer engine.

Usage: python scripts/fetch_opponent.py /absolute/path/to/opponent
Pass --check-only to verify existing WASM/data/worker assets without downloading.
The JS preload guard is needed for Node's shared-memory worker integration.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

BASE = 'https://raw.githubusercontent.com/honux77/shogi/d56946ec9861c8f8d6d9489a65c194cb525abdc3/public/engine/'
BLOBS = {
    'yaneuraou.js': 'bace3fad5d4f561113294a773a747af44c95d4be',
    'yaneuraou.worker.js': '82fd6bf17b114debb87c580596ebfd6b03d3dd3e',
    'yaneuraou.wasm': '0a630de6b2d6e0e96f7ca3adc20b011691543c1c',
    'yaneuraou.data': 'b8ac99947ddef4b5ff100a96754c148c00e034b0',
}
SOURCE = 'https://github.com/arashigaoka/YaneuraOu.wasm/tree/b2defb6d255ea44b3fead30e13f28b96e0ab0cc7'

def blob(data):
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('directory',type=Path)
    p.add_argument('--check-only',action='store_true')
    args=p.parse_args(); target=args.directory.resolve()
    target.mkdir(parents=True,exist_ok=True)
    manifest={}
    for name,expected in BLOBS.items():
        path=target/name
        if args.check_only:
            data=path.read_bytes()
            if name=='yaneuraou.js':
                if data.count(b'if(!A.ENVIRONMENT_IS_PTHREAD)')!=1:
                    raise ValueError('Missing main-thread preload guard')
                original=data.replace(b'/* shogi-AI: preload evaluation data only in the main engine worker. */\n',b'',1).replace(b'if(!A.ENVIRONMENT_IS_PTHREAD)',b'',1)
                if blob(original)!=expected and not (original.endswith(b'\n') and blob(original[:-1])==expected):
                    raise ValueError('Pinned JavaScript mismatch')
            elif blob(data)!=expected and not (data.endswith(b'\n') and blob(data[:-1])==expected):
                raise ValueError('Pinned asset mismatch: '+name)
        else:
            with urlopen(BASE+name,timeout=90) as response:
                data=response.read()
            if blob(data)!=expected:
                raise ValueError('Pinned asset mismatch: '+name)
            if name=='yaneuraou.js':
                needle=b'(function(a){function b(n,v,p){var r=new XMLHttpRequest;'
                if data.count(needle)!=1:
                    raise ValueError('Cannot identify the evaluation preload IIFE')
                data=data.replace(needle,b'/* shogi-AI: preload evaluation data only in the main engine worker. */\nif(!A.ENVIRONMENT_IS_PTHREAD)'+needle,1)
            if name in ('yaneuraou.js','yaneuraou.worker.js'):
                data+=b'\n'  # Match the recorded distribution's trailing newline.
            path.write_bytes(data)
        manifest[name]=hashlib.sha256(data).hexdigest()
    if not args.check_only:
        (target/'package.json').write_text('{"type":"commonjs","private":true}\n')
        (target/'SOURCE.txt').write_text('YaneuraOu.wasm 0.1.2; GPLv3\nCorresponding source and license: '+SOURCE+'\nEvaluation: source/eval/nn.bin (2019-01-15 KP256)\nLocal modification: load evaluation data only in the main engine worker.\n')
    print(json.dumps({'verified':True,'directory':str(target),'sha256':manifest},indent=2))

if __name__=='__main__':
    main()
