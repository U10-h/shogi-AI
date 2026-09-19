# Third-party components

## tsshogi

- Author: Ryosuke Kubo / sunfish-shogi contributors.
- License: MIT; original notice is included in `vendor/tsshogi/LICENSE` and `dist/vendor/tsshogi/LICENSE`.
- Source: https://github.com/sunfish-shogi/tsshogi/tree/c672603be519744b1f60fd5efcae8750556301d7
- Vendored source: `vendor/tsshogi/src` (library sources, excluding upstream tests).
- Transformation: `scripts/vendor.mjs` removes TypeScript-only named imports, uses Node 24 `stripTypeScriptTypes`, and adds `.js` extensions for browser imports. No intentional rule changes.

## YaneuraOu WebAssembly

- Authors: YaneuraOu contributors, Yuta Okumura / arashigaoka; based in part on Stockfish and stockfish.wasm. Copyright notices remain in the corresponding source.
- License: GPLv3. See `LICENSE` and `dist/vendor/yaneuraou/Copying.txt`.
- Package: `yaneuraou.wasm@0.1.2`; engine reports `YaneuraOu NNUE KP256 6.03 32SSE42 TOURNAMENT`.
- Corresponding source and build scripts: https://github.com/arashigaoka/YaneuraOu.wasm/tree/b2defb6d255ea44b3fead30e13f28b96e0ab0cc7
- Downloadable source archive: https://github.com/arashigaoka/YaneuraOu.wasm/archive/b2defb6d255ea44b3fead30e13f28b96e0ab0cc7.zip
- Evaluation source: `source/eval/nn.bin` in that source tree. Upstream identifies it as https://github.com/yaneurao/YaneuraOu/releases/tag/20190115_k-p-256-32-32
- Distribution files retrieved from the fixed mirror https://github.com/honux77/shogi/tree/d56946ec9861c8f8d6d9489a65c194cb525abdc3/public/engine, whose README identifies the unmodified package distribution. No application code from that repository is used.

Original Git blob SHA-1 identifiers:

| File | Original blob SHA |
|---|---|
| yaneuraou.js | bace3fad5d4f561113294a773a747af44c95d4be |
| yaneuraou.worker.js | 82fd6bf17b114debb87c580596ebfd6b03d3dd3e |
| yaneuraou.wasm | 0a630de6b2d6e0e96f7ca3adc20b011691543c1c |
| yaneuraou.data | b8ac99947ddef4b5ff100a96754c148c00e034b0 |

Changes on 2026-09-19: `yaneuraou.js` wraps the evaluation preload IIFE with `if(!A.ENVIRONMENT_IS_PTHREAD)` so only the main engine worker loads evaluation data. Pthreads share memory and do not need separate data loading. The other three distribution files are unchanged. `package.json` sets CommonJS solely for the Node integration check; classic browser scripts do not use that metadata. The application sets Threads=1 and USI_Hash=32 through USI.

To rebuild the upstream distribution, obtain the complete corresponding source above and Emscripten 2.0.21-compatible tools, then run the upstream `npm run prepare` (`cd source && make clean tournament`). Apply the documented preload guard to the generated JavaScript. This project does not claim bit-for-bit reproduction with other compiler versions. `npm run check` verifies the bundled WASM and evaluation data against the recorded Git blob identifiers.

The application's original code is distributed under GPLv3. Third-party MIT notices are preserved. The browser's credits page links to the full corresponding source and source download alongside the engine license.
