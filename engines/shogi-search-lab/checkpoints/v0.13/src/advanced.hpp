#pragma once
#include "lab.hpp"
#include <map>
#include <set>

namespace lab {
// All experimental policies are explicit. No selective rule is on by default.
struct AdvancedOptions {
    Options limits;
    std::string driver = "pvs";
    std::set<std::string> features = {"tt", "history", "killer", "counter", "mate-distance"};
    size_t tt_capacity = 100000;
    int multipv = 1;
    int qdepth = 6;
    int extension_budget = 2;
    int aspiration = 80;
    std::string probcut_model;
    std::string evaluation = "material";
    std::string evaluation_model;
    bool eager_evaluation = false; // Control for redundant static-evaluation ablation.
    bool compact_ordering = true;
    bool direct_qmoves = true;
    bool defer_qmoves = true;
    // Opt-in qsearch observation. Does not alter ordering, scores or node budgets.
    std::string leaf_trace_path;
    // Experimental learned q-move pruning. Labels are alpha-threshold outcomes,
    // never unqualified exact values. No policy is enabled by default.
    std::string prune_policy = "off"; // off, collect, direct, guarded, verified, staticcheck, efficient
    std::string prune_model;
    std::string prune_log_path;
    double prune_probability = -1; // -1 uses the calibrated model threshold.
    bool prune_audit = false; // Expensive counterfactuals, excluded from speed tests.
};
struct AdvancedLine {int score = 0; std::vector<Move> pv;};
struct AdvancedResult {
    Result base;
    // A legal emergency move is separate from a completed search result.
    // The partial score is only the best among completed root children.
    std::vector<Move> fallback_pv;
    int fallback_score = 0;
    std::string fallback_source;
    uint64_t completed_root_moves = 0;
    std::vector<AdvancedLine> candidates;
    std::map<std::string, uint64_t> stats;
    bool selective = false;
    std::string leaf_policy;
};
std::set<std::string> advanced_features();
void set_advanced_preset(AdvancedOptions& options, const std::string& preset);
void set_advanced_features(AdvancedOptions& options, const std::string& csv);
AdvancedResult advanced_search(Board& board, const AdvancedOptions& options);
std::string advanced_json(const AdvancedResult& result, const AdvancedOptions& options);
int advanced_selftest();
int advanced_usi(const AdvancedOptions& defaults);
}
