# Corresponding source and local change

This directory distributes YaneuraOu.wasm 0.1.2 (YaneuraOu NNUE KP256 6.03).
License: GPLv3, included as Copying.txt. Preserve upstream copyright notices.

`corresponding-source.zip` is the unchanged complete source archive at:
https://github.com/arashigaoka/YaneuraOu.wasm/tree/b2defb6d255ea44b3fead30e13f28b96e0ab0cc7

SHA-256 of the archive:
15e6ac502d282adec7b9e17609b7e7265adfe56c08cd498be0f3a3351b8ea227

The archive includes C++ sources, Makefile, pre.js, build metadata, license,
and source/eval/nn.bin. The latter is byte-for-byte identical to the served
`yaneuraou.data`. The source README identifies the 2019-01-15 KP256 evaluation.
The GPL text here differs from the source only by a trailing blank line.

To build:
1. Extract the archive and install compatible Emscripten 2.0.21 tools.
2. Run `npm run prepare` in the extracted root. The upstream command runs
   `cd source && make clean tournament`, then moves the generated JS, worker,
   WASM and data to the root. No application npm dependencies are needed.
3. Apply the application change described below to the generated JavaScript.
4. Serve the files over HTTPS with COOP=same-origin and COEP=require-corp.
   The app uses one search thread per engine and 32 or 16 MiB USI_Hash.

Change made on 2026-09-19:
The generated evaluation preload IIFE is guarded by `if(!A.ENVIRONMENT_IS_PTHREAD)`.
In our distributed minified JS, insert the following immediately before the
first `(function(a){function b(n,v,p){var r=new XMLHttpRequest;` IIFE:

    /* shogi-AI: preload evaluation data only in the main engine worker. */
    if(!A.ENVIRONMENT_IS_PTHREAD)

`A` is the Emscripten module variable in this build. This prevents the pthread
worker from downloading evaluation data a second time. If another compiler
uses a different module variable, use that variable instead. The full modified
JS is included next to this document and in shogi-ai-source.zip.
WASM, worker JS and evaluation data have not been changed. Different toolchain
versions are not claimed to produce bit-identical binaries.
