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
};
struct AdvancedLine {int score = 0; std::vector<Move> pv;};
struct AdvancedResult {
    Result base;
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
