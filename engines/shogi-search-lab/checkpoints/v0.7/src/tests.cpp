#include "lab.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>

namespace lab {
int selftest() {
    int checks = 0;
    auto require = [&](bool ok, const std::string& label) {
        ++checks;
        if (!ok) throw std::runtime_error("Test failed: " + label);
    };
    auto has = [](const Board& b, const std::string& text) {
        const auto moves = b.legal_moves();
        return std::any_of(moves.begin(), moves.end(), [&](Move m){return usi(m) == text;});
    };
    Board start;
    require(evaluate(start) == 0, "initial material");
    const auto initial = start.pos.sfen();
    require(perft(start, 1) == 30, "perft 1");
    require(perft(start, 2) == 900, "perft 2");
    require(perft(start, 3) == 25470, "perft 3");
    require(start.pos.sfen() == initial && start.history.size() == 1, "make/unmake restores history");
    Board drops("4k4/9/9/9/9/9/4P4/9/4K4 b P 1");
    require(!has(drops, "P*5e"), "nifu");
    require(!has(drops, "P*4a"), "dead pawn drop");
    require(has(drops, "P*4e"), "ordinary pawn drop");
    Board promotion("4k4/P8/9/9/9/9/9/9/4K4 b - 1");
    require(!has(promotion, "9b9a") && has(promotion, "9b9a+"), "mandatory promotion");
    Board optional("4k4/9/P8/9/9/9/9/9/4K4 b - 1");
    require(has(optional, "9c9b") && has(optional, "9c9b+"), "optional nonpromotion retained");
    Board pawnmate("3lkl3/3p1p3/4G4/9/9/9/9/9/K8 b P 1");
    require(!has(pawnmate, "P*5b"), "pawn drop mate prohibited");
    Board pinned("k3r4/9/9/9/9/9/4G4/9/4K4 b P 1");
    require(!has(pinned, "5g4g") && has(pinned, "5g5f"), "pin exposes king");
    Board exchange;
    exchange.play_input("7g7f 3c3d 8h2b+ 3a2b");
    require(hand_count(exchange.pos.hand_of(BLACK), BISHOP) == 1 && hand_count(exchange.pos.hand_of(WHITE), BISHOP) == 1, "captured bishop demoted to hand");
    require(evaluate(exchange) == 0 && has(exchange, "B*5e"), "exchange material and drop");
    Board repeat("4k4/9/9/9/9/9/9/9/4K4 b - 1");
    const std::string cycle = "5i4i 5a4a 4i5i 4a5a";
    repeat.play_input(cycle + " " + cycle);
    require(!repeat.repetition_score(0), "threefold is not fourfold");
    repeat.play_input(cycle);
    require(repeat.repetition_score(0) == 0, "fourfold draw");
    // Rook follows the king on adjacent files, checking on every black move.
    Board perpetual("4k4/9/5R3/9/9/9/9/9/K8 b - 1");
    const std::string checks_cycle = "4c5c 5a4a 5c4c 4a5a";
    perpetual.play_input(checks_cycle + " " + checks_cycle + " " + checks_cycle);
    require(perpetual.repetition_score(0) == -mate, "perpetual checking side loses");
    // Protect the checking gold with a rook; the king cannot capture it.
    Board mate_position("3lkl3/3pGp3/4R4/9/9/9/9/9/K8 w - 1");
    require(mate_position.legal_moves().empty(), "mate fixture has no legal move");
    Options options;
    options.depth = 0;
    auto mate_result = search(mate_position, options);
    require(mate_result.score == -mate && mate_result.terminals == 1, "mate recognized at horizon");
    for (Board* b : {&start, &exchange, &promotion, &pinned}) {
        options.depth = 2;
        options.algorithm = Algorithm::minimax;
        const auto before = b->pos.sfen();
        const auto history_size = b->history.size();
        const auto truth = search(*b, options);
        require(truth.complete, "baseline complete");
        for (Algorithm a : {Algorithm::alphabeta, Algorithm::ordered}) {
            options.algorithm = a;
            const auto pruned = search(*b, options);
            require(pruned.complete && pruned.score == truth.score, "same root minimax score");
            require(pruned.nodes <= truth.nodes, "alpha-beta visits no more nodes");
            if (!pruned.pv.empty()) {
                PlayedMove played(*b, pruned.pv.front());
                Options child;
                child.algorithm = Algorithm::minimax;
                child.depth = options.depth - 1;
                const auto child_truth = search(*b, child);
                // These fixtures have no mate score; mate-distance uses root ply.
                require(-child_truth.score == truth.score, "chosen root move is optimal");
            }
        }
        require(b->pos.sfen() == before && b->history.size() == history_size, "search restores board");
    }
    options.depth = 4;
    options.max_nodes = 7;
    const auto aborted = search(start, options);
    require(!aborted.complete && aborted.nodes == 7 && aborted.pv.empty(), "node budget abort");
    require(start.pos.sfen() == initial && start.history.size() == 1, "abort unwinds all moves");
    // Iterative search must match every completed fixed-depth reference.
    for (Board* b : {&start, &exchange, &promotion, &pinned}) {
        Options iterative;
        iterative.iterative = true;
        iterative.depth = 3;
        for (bool pv_order : {false, true}) {
            iterative.pv_order = pv_order;
            const auto iter = search(*b, iterative);
            require(iter.complete && iter.has_result && iter.completed_depth == 3, "iterative target depth completed");
            for (const auto& step : iter.iterations) {
                Options reference;
                reference.algorithm = Algorithm::minimax;
                reference.depth = step.depth;
                const auto exact = search(*b, reference);
                require(exact.complete && exact.score == step.score, "every iteration agrees with full minimax");
            }
            require(pv_order ? iter.pv_priority_nodes > 0 : iter.pv_priority_nodes == 0, "PV ordering ablation");
        }
    }
    Options shallow;
    shallow.depth = 1;
    const auto depth_one = search(start, shallow);
    for (uint64_t budget : {uint64_t{1}, depth_one.nodes, depth_one.nodes + 5}) {
        Options limited;
        limited.iterative = true;
        limited.depth = 4;
        limited.max_nodes = budget;
        const auto r = search(start, limited);
        require(!r.complete && r.stop_reason == "node_limit" && r.nodes == budget, "iteration total node budget");
        if (budget < depth_one.nodes) {
            require(!r.has_result && r.completed_depth == -1 && r.pv.empty(), "no result before first completion");
        } else {
            require(r.has_result && r.completed_depth == 1 && r.score == depth_one.score && r.pv == depth_one.pv, "interrupted iteration preserves completed PV exactly");
        }
        require(start.pos.sfen() == initial && start.history.size() == 1, "iterative budget restores board");
    }
    // Deterministic fake time exercises actual deadline checks, independent of CPU load.
    for (uint64_t deadline : {uint64_t{1}, uint64_t{50}}) {
        double clock = 0;
        Options timed;
        timed.iterative = true;
        timed.depth = 4;
        timed.time_ms = deadline;
        timed.clock_ms = [&clock]() {return clock++;};
        const auto r = search(start, timed);
        require(!r.complete && r.stop_reason == "time_limit", "deadline causes interruption");
        require(deadline == 1 ? !r.has_result : r.has_result && r.completed_depth == 1 && r.pv == depth_one.pv, "deadline exposes only completed result");
        require(start.pos.sfen() == initial && start.history.size() == 1, "deadline unwinds all moves");
    }
    Options terminal;
    terminal.iterative = true;
    terminal.depth = 8;
    const auto drawn = search(repeat, terminal);
    require(drawn.complete && drawn.has_result && drawn.score == 0 && drawn.stop_reason == "terminal", "terminal draw needs no deeper iteration");
    const auto checked = search(perpetual, terminal);
    require(checked.complete && checked.score == -mate, "iterative perpetual check loss");
    const auto mated = search(mate_position, terminal);
    require(mated.complete && mated.score == -mate && mated.pv.empty(), "iterative terminal mate");
    terminal.depth = 0;
    const auto zero = search(start, terminal);
    require(zero.complete && zero.has_result && zero.completed_depth == 0 && zero.pv.empty() && zero.score == 0, "depth zero is an evaluation, not an invented move");
    for (const std::string bad : {"9/9 b - 1", "9/9/9/9/9/9/9/9/9 b - 1", "4k4/9/9/9/9/9/9/9/4K4 b 99P 1"}) {
        bool rejected = false;
        try {Board invalid(bad);} catch (const std::invalid_argument&) {rejected = true;}
        require(rejected, "malformed SFEN rejected");
    }
    std::cout << "{\"selftest\":\"passed\",\"checks\":" << checks << "}\n";
    return 0;
}
}
