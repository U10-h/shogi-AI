#include "session.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>

namespace lab {
namespace {
int as_parent(int child) {
    int score = -child;
    return score > 90000 ? score - 1 : score < -90000 ? score + 1 : score;
}
std::vector<std::pair<std::string, int>> exhaustive_five(Board& b, int depth) {
    std::vector<std::pair<std::string, int>> candidates;
    for (Move move : b.legal_moves()) {
        PlayedMove played(b, move);
        Options o;
        o.algorithm = Algorithm::minimax;
        o.depth = depth - 1;
        auto exact = search(b, o);
        if (!exact.complete) throw std::runtime_error("Reference did not finish");
        candidates.emplace_back(usi(move), as_parent(exact.score));
    }
    std::sort(candidates.begin(), candidates.end(), [](auto& a, auto& b){return a.second != b.second ? a.second > b.second : a.first < b.first;});
    if (candidates.size() > 5) candidates.resize(5);
    return candidates;
}
}
int session_selftest() {
    int checks = 0;
    auto require = [&](bool condition, const std::string& label) {++checks; if (!condition) throw std::runtime_error("Session test: " + label);};
    auto same_candidates = [&](const SessionView& a, const SessionView& b) {
        require(a.score == b.score && a.completed_depth == b.completed_depth && a.candidates.size() == b.candidates.size(), "warm/cold score and candidate count");
        for (size_t i = 0; i < a.candidates.size(); ++i)
            require(a.candidates[i].move == b.candidates[i].move && a.candidates[i].score == b.candidates[i].score, "warm/cold exact top five");
    };
    const std::vector<std::string> positions = {
        SFEN_HIRATE,
        "8k/9/4g4/4p4/4R4/9/9/9/K8 b - 1",
        "4k4/9/P8/9/9/9/9/9/4K4 b - 1",
        "3lkl3/3p1p3/4G4/4R4/9/9/9/9/K8 b - 1",
        "k3r4/9/9/9/9/9/4G4/9/4K4 b P 1"};
    for (auto& sfen : positions) {
        TreeSession session(sfen);
        Board reference(sfen);
        for (int depth = 1; depth <= 3; ++depth) {
            Options o; o.depth = depth;
            const auto result = session.analyze(o);
            require(result.complete && result.view.candidates_complete, "completed ranking");
            const auto expected = exhaustive_five(reference, depth);
            require(result.view.candidates.size() == expected.size(), "top-k includes fewer than five if necessary");
            for (size_t i = 0; i < expected.size(); ++i) {
                auto& c = result.view.candidates[i];
                require(usi(c.move) == expected[i].first && c.score == expected[i].second, "full-width top-five ranking");
                require(result.view.candidate_node_ids[i] != 0, "all five subtrees retained");
                Board replay(sfen);
                std::string moves;
                for (Move m : c.pv) {if (!moves.empty()) moves += ' '; moves += usi(m);}
                replay.play_input(moves);
                Options leaf; leaf.depth = 0;
                auto end = search(replay, leaf);
                int value = end.score;
                for (size_t j = 0; j < c.pv.size(); ++j) value = as_parent(value);
                require(value == c.score, "PV legality and endpoint evaluation");
            }
            const auto repeated = session.analyze(o);
            require(repeated.nodes == 0 && repeated.ranking_hits > 0, "completed ranking reused without search");
            require(repeated.view.candidate_node_ids == result.view.candidate_node_ids, "repeated go keeps subtree identities");
        }
    }
    // Each of the retained five must survive becoming the new root.
    for (size_t rank = 0; rank < 5; ++rank) {
        TreeSession session;
        Options o; o.depth = 3;
        const auto before = session.analyze(o);
        const auto line = before.view.candidates[rank];
        const auto advanced = session.play(usi(line.move));
        require(advanced.reused_tree && advanced.previous_rank == static_cast<int>(rank + 1), "every retained rank can be played");
        require(advanced.view.root_id == before.view.candidate_node_ids[rank], "same node promoted to root");
        require(advanced.view.has_result && advanced.view.completed_depth == 2 && advanced.view.score == -line.score, "retained child score and depth");
        require(advanced.view.pv == std::vector<Move>(line.pv.begin() + 1, line.pv.end()), "retained PV suffix");
        require(advanced.view.history_positions == 2, "history retained");
        TreeSession cold(SFEN_HIRATE, usi(line.move));
        const auto warm_result = session.analyze(o), cold_result = cold.analyze(o);
        same_candidates(warm_result.view, cold_result.view);
        require(warm_result.exact_hits + warm_result.bound_hits > 0, "real subtree entries reused after play");
    }
    TreeSession outside;
    Options o; o.depth = 2;
    const auto before = outside.analyze(o);
    Board initial;
    auto moves = initial.legal_moves();
    auto other = std::find_if(moves.begin(), moves.end(), [&](Move m){return std::none_of(before.view.candidates.begin(), before.view.candidates.end(), [&](const auto& c){return c.move == m;});});
    const auto unknown = outside.play(usi(*other));
    require(!unknown.reused_tree && !unknown.view.has_result, "outside retained five gets fresh tree");
    TreeSession cold_other(SFEN_HIRATE, usi(*other));
    same_candidates(outside.analyze(o).view, cold_other.analyze(o).view);
    // Tight memory changes retained detail, never the result or the five branches.
    TreeSession small(positions[2], "", 32), roomy(positions[2]);
    o.depth = 4;
    const auto small_r = small.analyze(o), roomy_r = roomy.analyze(o);
    same_candidates(small_r.view, roomy_r.view);
    require(small_r.capacity_misses > 0 && small_r.view.tree_nodes <= 32, "hard retained-node cap");
    for (auto id : small_r.view.candidate_node_ids) require(id != 0, "five roots survive memory pressure");
    // An aborted iteration cannot replace a completed top five.
    TreeSession interrupted;
    o.depth = 2;
    const auto committed = interrupted.analyze(o);
    o.depth = 4; o.max_nodes = 8;
    const auto partial = interrupted.analyze(o);
    require(!partial.complete && partial.stop_reason == "node_limit" && partial.nodes == 8, "session node budget");
    same_candidates(committed.view, partial.view);
    require(partial.view.sfen == committed.view.sfen && partial.view.history_positions == 1, "abort restores board and history");
    o.max_nodes = 2000000; o.depth = 3;
    const auto resumed = interrupted.analyze(o);
    TreeSession clean;
    same_candidates(resumed.view, clean.analyze(o).view);
    double clock = 0;
    Options timed; timed.depth = 5; timed.time_ms = 3; timed.clock_ms = [&clock](){return clock++;};
    const auto timeout = interrupted.analyze(timed);
    require(!timeout.complete && timeout.stop_reason == "time_limit", "deterministic time interruption");
    same_candidates(resumed.view, timeout.view);
    const auto stable = interrupted.show();
    bool rejected = false;
    try {interrupted.play("5a5i");} catch (const std::invalid_argument&) {rejected = true;}
    require(rejected && interrupted.show().root_id == stable.root_id && interrupted.show().sfen == stable.sfen, "illegal move is transactional");
    // Re-rooting changes mate distance by one, not merely the score's sign.
    TreeSession mating(positions[3]);
    o.depth = 2;
    const auto mate_found = mating.analyze(o);
    require(mate_found.view.score == mate - 1, "mate-in-one ranked first");
    const auto after_mate = mating.play(usi(mate_found.view.candidates[0].move));
    require(after_mate.view.score == -mate && after_mate.view.terminal, "mate distance normalized at new root");
    require(mating.analyze(o).stop_reason == "terminal", "terminal after retained mate");
    // Same board with different histories must NOT share cached draw/check values.
    const std::string kings = "4k4/9/9/9/9/9/9/9/4K4 b - 1";
    const std::string cycle = "5i4i 5a4a 4i5i 4a5a";
    TreeSession repeated(kings, cycle + " " + cycle + " 5i4i 5a4a 4i5i");
    o.depth = 1;
    repeated.analyze(o);
    repeated.play("4a5a");
    require(repeated.analyze(o).view.terminal && repeated.show().score == 0, "fourfold keeps real history after play");
    TreeSession no_history(kings);
    require(!no_history.analyze(o).view.terminal, "same board without repetition is not terminal");
    const std::string checking = "4k4/9/5R3/9/9/9/9/9/K8 b - 1";
    const std::string checking_cycle = "4c5c 5a4a 5c4c 4a5a";
    TreeSession perpetual(checking, checking_cycle + " " + checking_cycle + " 4c5c 5a4a 5c4c");
    perpetual.analyze(o);
    perpetual.play("4a5a");
    require(perpetual.analyze(o).view.score == -mate && perpetual.show().terminal, "continuous checking loss after re-root");
    std::cout << "{\"session_selftest\":\"passed\",\"checks\":" << checks << "}\n";
    return 0;
}
}
