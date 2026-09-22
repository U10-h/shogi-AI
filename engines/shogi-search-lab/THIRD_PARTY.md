# Third-party provenance

## YaneuraOu rules and board implementation

- Original project: https://github.com/yaneurao/YaneuraOu
- Reused fixed fork: https://github.com/arashigaoka/YaneuraOu.wasm/tree/b2defb6d255ea44b3fead30e13f28b96e0ab0cc7
- Authors: YaneuraOu contributors, Yuta Okumura / arashigaoka, and upstream Stockfish contributors; original notices remain in the files.
- License: GNU GPL version 3; original license is `vendor/yaneuraou/LICENSE`.
- Local source: the existing site's `dist/vendor/yaneuraou/corresponding-source.zip`, SHA-256 `15e6ac502d282adec7b9e17609b7e7265adfe56c08cd498be0f3a3351b8ea227`.
- Snapshot extraction: `.cpp`, `.h`, and `.hpp` files beneath `source/`. This is a research subset of the source distribution, not a complete upstream WASM release.
- In the main engine, only `bitboard.cpp`, `position.cpp`, `movegen.cpp`, `types.cpp`, and the no-evaluation configuration of `eval/evaluate.cpp` are built directly from upstream. The test-only NNUE oracle additionally builds `eval/evaluate_bona_piece.cpp` and NNUE K/P feature code and instantiates the upstream transformer/layer templates. Other source files are retained for reading.
- No upstream search implementation is linked. The complete pretrained neural network remains external. In v0.8, `src/nnue.cpp` implements compatible inference, following the fixed upstream K+P feature numbering, architecture, integer arithmetic, and binary layout. It is distributed under this project’s GPL-3.0 license.

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

## Optional pretrained K+P NNUE (v0.8)

- Fixed weights: `source/eval/nn.bin` (2019-01-15 KP256) from the pinned YaneuraOu.wasm distribution above. The matching distribution asset `yaneuraou.data` consists of these model bytes directly.
- SHA-256: `cf7645f64bf6baa5c74612799ce562752f7985923b1f0fc2e6092c998ed867f9`; size 893917 bytes.
- Fetch/verification: `scripts/fetch_opponent.py`, pinned file Git blob IDs and source references. This archive does not redistribute the complete pretrained network; consult the upstream distribution for its terms and provenance. The baseline is not independently trained here.
- Architecture: K+P[1710→256×2], dense layers 512→32→32→1, integer inference. This is K+P, not HalfKP.
- The adapter preserves upstream raw scores (PawnValue=90); USI output converts ordinary scores to cp using `score * 100 / 90`. Search JSON declares the raw score unit.

## Trained NNUE head derivatives (v0.10)

- `models/v0.10/*.npz` contain 1089-parameter head derivatives initialized from the pinned network above; unchanged head parameters retain upstream provenance. These are transfer-learning artifacts, not independently trained full networks. The `*-float.npz` files are corresponding optimizer-space checkpoints.
- The 454432 parameters of the feature transformer and first dense layer are frozen and are not included in these head files. Export requires the exact externally obtained base model and verifies its SHA-256.
- Labels are locally generated outputs of that same pinned YaneuraOu teacher. They are not human game annotations or an independent test of the teacher's strength.
- Training, selection, limitations, and provenance are described in `models/v0.10/MODEL_CARD.md` and `REPORT-v0.10.md`.

## v0.18 static exchange helper

The main build additionally enables the pinned upstream `Position::see_ge` and compiles `eval/evaluate_bona_piece.cpp` with `USE_SEE` / `USE_PIECE_VALUE`. This supplies the original material-exchange tables (pawn 90), not an upstream search algorithm. The optional `qguard` uses the zero threshold as a heuristic and protects checks, promotions, recaptures, kings and captures within two squares of either king. The NNUE value model is unchanged.
