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

## Optional local conversation

- WebLLM `@mlc-ai/web-llm@0.2.85`, MLC AI, Apache-2.0. Loaded on demand through `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm`. Source and license: https://github.com/mlc-ai/web-llm .
- Qwen2.5 0.5B / 1.5B Instruct, Qwen team, Apache-2.0. Original model: https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct and https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct .
- MLC quantized distributions: https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC and https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC (float32 variants are selected when needed).
- The application archive does not include these model weights or the WebLLM distribution. They are downloaded by the user's browser only on explicit activation. Runtime support follows the published WebLLM model registry.
- API references: https://webllm.mlc.ai/docs/user/basic_usage.html and https://webllm.mlc.ai/docs/user/advanced_usage.html .

## Distribution audit — 2026-09-19

- No paid model API, API key, payment SDK, cloud inference endpoint or remote game-upload call is present in the authored runtime. `engine.chat.completions.create` in `tutor-worker.js` is an API of the local WebLLM instance, not an OpenAI cloud request. WebMCP readback returns the visible position only when its caller invokes it.
- Base app and NNUE assets are fetched from the site. Explicit local-language-model activation downloads code / weights from jsDelivr, Hugging Face and the MLC model-library sources named in WebLLM's registry. These hosts receive ordinary download request metadata; inference and questions remain local in this implementation. Hosting/authentication, connectivity and any existing ChatGPT subscription are separate from AI API metering.
- The complete upstream engine source archive is now mirrored as `dist/vendor/yaneuraou/corresponding-source.zip`, with SHA-256 `15e6ac502d282adec7b9e17609b7e7265adfe56c08cd498be0f3a3351b8ea227`. Its evaluation `source/eval/nn.bin` was compared byte-for-byte with our served `.data` and matches. Local build/change directions are `dist/vendor/yaneuraou/BUILDING.md`. Both files are offered beside the binary and included in the application source ZIP. A complete C++ rebuild has not been performed in this environment.
- Upstream's package and repository specify GPLv3 and include the evaluation data without a separate license file. The original 2019 release and its author's article identify its provenance, but do not spell out an independent evaluation-data license. This audit records the upstream distribution's terms; it does not establish an independent chain-of-title guarantee for the original training data or all possible rights. Do not represent it as a rights-free asset. Original release: https://github.com/yaneurao/YaneuraOu/releases/tag/20190115_k-p-256-32-32
- Original license copies for WebLLM 0.2.85 and the two enabled Qwen models are in `dist/vendor/optional-ai/`; they are linked in the browser credits. The WebLLM license includes its third-party attribution appendix. Models remain optional downloads and are not copied into the app source archive.
- Board, pieces and icon use authored HTML/CSS/SVG and system-font text. No Shogi Wars / Piyo Shogi artwork, sounds, paid commentary, book passages or commercial opening databases are bundled. Names identify supported record sources; no affiliation is claimed. User-imported records/images and any later public redistribution need a separate check of their source terms.
- Copyrighted open-source software is used under license, not free of copyright. Recipients must retain notices and licenses and, when conveying GPL binaries, provide the corresponding source as required by GPLv3. This audit is not a guarantee covering unexamined patents, trademarks or future dependencies.
