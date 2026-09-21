#pragma once
#include "lab.hpp"
#include <memory>

namespace lab {
struct CandidateLine {
    Move move = MOVE_NONE;
    int score = 0;
    int depth = 0;
    std::vector<Move> pv;
    bool child_terminal = false;
};
struct SessionView {
    bool has_result = false, candidates_complete = false, terminal = false;
    int completed_depth = -1, score = 0;
    std::vector<Move> pv;
    std::vector<CandidateLine> candidates;
    uint64_t root_id = 0, tree_nodes = 0;
    std::vector<uint64_t> candidate_node_ids;
    std::string sfen;
    size_t history_positions = 0;
};
struct SessionResult {
    SessionView view;
    int requested_depth = 0;
    bool complete = false;
    std::string stop_reason;
    uint64_t nodes = 0, exact_hits = 0, bound_hits = 0, ranking_hits = 0, cutoffs = 0;
    uint64_t capacity_misses = 0;
    double elapsed_ms = 0;
    std::vector<int> completed_iterations;
};
struct AdvanceResult {
    bool reused_tree = false;
    int previous_rank = 0;
    uint64_t previous_root_id = 0;
    SessionView view;
};

// Tree paths carry a single immutable move history. No transposition merging.
class TreeSession {
    struct Impl;
    std::unique_ptr<Impl> impl;
public:
    explicit TreeSession(const std::string& sfen = SFEN_HIRATE, const std::string& moves = "", uint64_t max_tree_nodes = 50000);
    ~TreeSession();
    TreeSession(const TreeSession&) = delete;
    TreeSession& operator=(const TreeSession&) = delete;
    SessionResult analyze(const Options& options);
    AdvanceResult play(const std::string& move);
    SessionView show() const;
    void clear_tree();
};
std::string session_json(const SessionResult& r);
std::string view_json(const SessionView& v);
std::string advance_json(const AdvanceResult& r);
int session_cli(const std::string& sfen, const std::string& moves, const Options& defaults, uint64_t capacity);
int session_selftest();
}
