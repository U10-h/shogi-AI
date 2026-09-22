# v0.12 experimental NNUE heads

These heads use the frozen historical KP256 feature transformer and first dense
layer specified by `scripts/ml_nnue.py`. They are not full NNUE training runs.

- `pair50.npz`: Huber regression on same-root sibling score gaps, residual factor 0.5.
- `pair100.npz`: residual factor 1.0; selected at epoch 20 on v0.10 validation gap MAE.
- `affine-gap.npz`: simple scale/bias approximation to pair100 on training quiet positions,
  with mean correction centered after quantization. Not an exact real-valued affine map.
- `pair-rank.npz`: rejected logistic-rank experiment; selected checkpoint 0 equals the base.

The mean correction is calibrated on training positions only. It is NOT
guaranteed to be zero on search leaves. This failed to transfer in v0.12:
pair100 was approximately -103.70 cp on visits to base-reached quiet qsearch nodes.

Do not promote pair100 on the strength of lower sibling MAE. Ranking accuracy
and match results did not establish an advantage; an always-zero gap diagnostic
also has lower MAE while being unable to rank moves. See `REPORT-v0.12.md`.

The original projected rank trial became unstable after failing validation.
The current trainer stops on quantized projection distortion and retains the
last valid checkpoint; the initial trial is archived for reproduction.

Export with `scripts/export_ml_model.py` using the hash-pinned base. Original
training/test splits, protocols, source hashes and integer inference checks are
under `results/v0.12/`. Models and experiment code retain the project's GPL-3.0
terms and the attribution in `THIRD_PARTY.md`.
