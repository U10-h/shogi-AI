# v0.16 evaluation hypotheses

No new training or test-driven weight fitting. Source: frozen v0.12 pair100.
Shared original feature transformer and first hidden layer; a second 32→32→1 head adds little incremental compute.

- baseline/adaptive: original NNUE.
- blend: E0 + trunc((Epair-E0)/4).
- clipped: E0 + clamp(trunc((Epair-E0)/4), -72, 72). Raw PawnValue=90, so cap=80cp.
- tempo: E0+36 raw (=40cp), a side-to-move offset control from prior experiments.

All results clamp to ±27000 raw. Negative integer division truncates toward zero.
These are hypotheses, not calibrated uncertainty estimates or claims of improved strength.
Source SHA256: a1e5561d49b63c8721b3fbc709f2d7e9d9379912b1cadd13506fe259eb8647d0
