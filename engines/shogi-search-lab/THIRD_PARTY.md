# Third-party provenance

## YaneuraOu rules and board implementation

- Original project: https://github.com/yaneurao/YaneuraOu
- Reused fixed fork: https://github.com/arashigaoka/YaneuraOu.wasm/tree/b2defb6d255ea44b3fead30e13f28b96e0ab0cc7
- Authors: YaneuraOu contributors, Yuta Okumura / arashigaoka, and upstream Stockfish contributors; original notices remain in the files.
- License: GNU GPL version 3; original license is `vendor/yaneuraou/LICENSE`.
- Local source: the existing site's `dist/vendor/yaneuraou/corresponding-source.zip`, SHA-256 `15e6ac502d282adec7b9e17609b7e7265adfe56c08cd498be0f3a3351b8ea227`.
- Snapshot extraction: `.cpp`, `.h`, and `.hpp` files beneath `source/`. This is a research subset of the source distribution, not a complete upstream WASM release.
- Only `bitboard.cpp`, `position.cpp`, `movegen.cpp`, `types.cpp`, and the no-evaluation configuration of `eval/evaluate.cpp` are built. Other upstream source files are retained for reading.
- No upstream search implementation or neural evaluation weights are linked or packaged.

### Local modification, 2026-09-21

`vendor/yaneuraou/position.cpp` has four conditional guards under `LAB_RULES_ONLY`:
one disables the upstream Thread node counter, three disable upstream transposition-table prefetches.
This permits board use without the upstream search/thread runtime. No legal-move logic is intentionally changed.
The UTF-8 BOM was removed from this file. The textual patch is `vendor/rules-only.patch`.
Build configuration enables `USE_GENERATE_ALL_LEGAL_MOVES` so optional nonpromotions are preserved.

## tsshogi, optional independent validation only

- Author: Ryosuke Kubo / sunfish-shogi contributors.
- Fixed source: https://github.com/sunfish-shogi/tsshogi/tree/c672603be519744b1f60fd5efcae8750556301d7
- License: MIT; notice in `vendor/tsshogi/LICENSE`.
- Copied from the existing site's generated JavaScript modules. That site strips TypeScript types and adds `.js` import extensions; no intentional rules modifications.
- This lab adds only an ESM `package.json`. These modules do not participate in the C++ engine or measured search timings.

## Benchmark position provenance

Four `gokigen-*` positions preserve initial SFEN and legal move history from the existing project's locally generated selfplay fixtures.
The old NNUE reference scores and selected moves are not imported into this lab.
The remaining four cases are the standard initial position, a short bishop exchange, and two small constructed rule positions.
The suite is frozen before timing and is not a representative strength-rating dataset.
