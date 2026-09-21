#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build results/v0.3
g++ -std=c++17 -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer \
    -ffunction-sections -fdata-sections -Ivendor/yaneuraou -DLAB_RULES_ONLY \
    -DUSE_GENERATE_ALL_LEGAL_MOVES -DNO_SSE -DASSERT_LV=1 \
    src/main.cpp src/board.cpp src/evaluate.cpp src/search.cpp src/tests.cpp \
    src/session.cpp src/session_cli.cpp src/session_tests.cpp \
    vendor/yaneuraou/bitboard.cpp vendor/yaneuraou/position.cpp \
    vendor/yaneuraou/movegen.cpp vendor/yaneuraou/types.cpp vendor/yaneuraou/eval/evaluate.cpp \
    -Wl,--gc-sections -pthread -o build/shogi-lab-sanitized
# LeakSanitizer cannot run in this environment's ptrace sandbox.
ASAN_OPTIONS=detect_leaks=0 ./build/shogi-lab-sanitized --selftest > results/v0.3/sanitizer-selftest.txt 2>&1
ASAN_OPTIONS=detect_leaks=0 ./build/shogi-lab-sanitized --session-selftest >> results/v0.3/sanitizer-selftest.txt 2>&1
cat results/v0.3/sanitizer-selftest.txt
