// GPL-3.0-or-later. Minimal search bridge to the pinned YaneuraOu runtime.
// This is a bounded-qsearch integration fixture, not a port of the v0.x playing engine.
#include "position.h"
#include "thread.h"
#include "usi.h"
#include <algorithm>
#include <chrono>
#include <sstream>
#include <thread>
#include <vector>

namespace {
using Clock = std::chrono::steady_clock;
struct Played {
    Position& pos;
    Move move;
    StateInfo state;
    Played(Position& p, Move m) : pos(p), move(m) { pos.do_move(move, state); }
    ~Played() { pos.undo_move(move); }
    Played(const Played&) = delete;
    Played& operator=(const Played&) = delete;
};
struct Line { int score = 0; std::vector<Move> pv; };

struct Bridge {
    MainThread& thread;
    Position& pos;
    bool prune, audit, aborted = false;
    const char* reason = "depth_limit";
    Clock::time_point started = Clock::now();
    uint64_t visits = 0, leaves = 0, eval_calls = 0, eval_checks = 0, mismatches = 0, cutoffs = 0;
    bool use_qsearch = false;
    int qdepth = 2;
    uint64_t qnodes = 0, qchecked = 0, qcheck_beyond_budget = 0, qevasions = 0;
    uint64_t qcaptures = 0, qpromotions = 0, qstand_cutoffs = 0, qchild_cutoffs = 0, qdepth_returns = 0;
    uint64_t qaborts = 0;
    std::string first_qcapture_sfen, first_qcheck_sfen;
    int max_ply = 0;
    bool tactical_order = false;
    uint64_t main_order_changes = 0, q_order_changes = 0;
    uint64_t main_first_cutoffs = 0, q_first_cutoffs = 0;
    uint64_t main_skipped_siblings = 0, q_skipped_siblings = 0;

    void order_moves(std::vector<Move>& moves, bool quiescence) {
        auto lexical = [](Move a, Move b) { return to_usi_string(a) < to_usi_string(b); };
        std::sort(moves.begin(), moves.end(), lexical);
        if (!tactical_order) return;
        // Captures and promotions share one priority class; retain lexical ties.
        // Only order changes. No move, depth, bound, or stand-pat rule changes.
        const auto first_quiet = std::find_if(moves.begin(), moves.end(),
            [&](Move m) { return !pos.capture_or_promotion(m); });
        const bool changed = std::any_of(first_quiet, moves.end(),
            [&](Move m) { return pos.capture_or_promotion(m); });
        if (changed) {
            if (quiescence) ++q_order_changes; else ++main_order_changes;
            std::stable_partition(moves.begin(), moves.end(),
                [&](Move m) { return pos.capture_or_promotion(m); });
        }
    }

    double elapsed() const { return std::chrono::duration<double, std::milli>(Clock::now()-started).count(); }
    bool stopped() {
        if (aborted) return true;
        if (Threads.stop) { reason = "external_stop"; aborted = true; }
        else if (thread.nodes >= 400000) { reason = "pilot_node_cap"; aborted = true; }
        else if (Search::Limits.nodes && thread.nodes >= uint64_t(Search::Limits.nodes)) {
            reason = "node_limit"; aborted = true;
        } else if (elapsed() >= 3000) { reason = "pilot_time_cap"; aborted = true; }
        else if (Search::Limits.movetime && elapsed() >= Search::Limits.movetime) {
            reason = "time_limit"; aborted = true;
        }
        return aborted;
    }
    int evaluate() {
        ++eval_calls;
        const int value = Eval::evaluate(pos); // Exactly the standard search's evaluator.
        if (audit) {
            ++eval_checks;
            if (value != int(Eval::compute_eval(pos))) {
                ++mismatches; aborted = true; reason = "evaluation_mismatch";
            }
        }
        return value;
    }
    Line qsearch(int alpha, int beta, int ply, int left) {
        if (stopped()) { ++qaborts; return {}; }
        ++visits; ++qnodes;
        max_ply = std::max(max_ply, ply);
        const auto repetition = pos.is_repetition();
        if (repetition != REPETITION_NONE)
            return {int(draw_value(repetition, pos.side_to_move())), {}};
        MoveList<LEGAL_ALL> legal(pos);
        if (legal.size() == 0) return {int(mated_in(ply)), {}};
        // Never turn an unresolved check into a stand-pat value at the safety ceiling.
        if (ply >= 8) { aborted = true; reason = "q_ply_guard"; ++qaborts; return {}; }
        const bool checked = pos.in_check();
        if (checked) {
            ++qchecked;
            if (left <= 0) ++qcheck_beyond_budget;
            if (first_qcheck_sfen.empty()) first_qcheck_sfen = pos.sfen();
        }
        const int evaluation = evaluate(); // Also prepares the ancestor accumulator.
        if (aborted) return {};
        Line best{checked ? -int(VALUE_INFINITE) : evaluation, {}};
        if (!checked) {
            if (left <= 0) { ++qdepth_returns; ++leaves; return best; }
            if (prune && best.score >= beta) { ++qstand_cutoffs; return best; }
            alpha = std::max(alpha, best.score);
        }
        std::vector<Move> moves;
        for (auto entry : legal) {
            const Move move = entry;
            if (checked || pos.capture_or_promotion(move)) moves.push_back(move);
        }
        order_moves(moves, true);
        size_t move_index = 0;
        for (Move move : moves) {
            ++move_index;
            if (stopped()) { ++qaborts; return {}; }
            if (checked) ++qevasions;
            if (pos.capture(move)) {
                ++qcaptures;
                if (first_qcapture_sfen.empty()) first_qcapture_sfen = pos.sfen();
            }
            if (is_promote(move)) ++qpromotions;
            Line child;
            {
                Played guard(pos, move);
                child = qsearch(prune ? -beta : -int(VALUE_INFINITE),
                                prune ? -alpha : int(VALUE_INFINITE), ply+1, left-1);
            }
            if (aborted) return {};
            if (-child.score > best.score) {
                best.score = -child.score; best.pv = {move};
                best.pv.insert(best.pv.end(), child.pv.begin(), child.pv.end());
            }
            alpha = std::max(alpha, best.score);
            if (prune && alpha >= beta) {
                ++qchild_cutoffs;
                if (move_index == 1) ++q_first_cutoffs;
                q_skipped_siblings += moves.size() - move_index;
                break;
            }
        }
        return best;
    }
    Line search(int depth, int alpha, int beta, int ply) {
        if (depth == 0 && use_qsearch) return qsearch(alpha, beta, ply, qdepth);
        if (stopped()) return {};
        ++visits;
        max_ply = std::max(max_ply, ply);
        const auto repetition = pos.is_repetition();
        if (repetition != REPETITION_NONE)
            return {int(draw_value(repetition, pos.side_to_move())), {}};
        // Check terminal status even at the horizon; no qsearch or check extension.
        MoveList<LEGAL_ALL> legal(pos);
        if (legal.size() == 0) return {int(mated_in(ply)), {}};
        if (depth == 0) { ++leaves; return {evaluate(), {}}; }
        // Prepare an ancestor accumulator before do_move, using upstream inference.
        evaluate();
        if (aborted) return {};
        std::vector<Move> moves;
        for (auto m : legal) {
            if (ply == 0 && std::find(thread.rootMoves.begin(), thread.rootMoves.end(), Move(m)) == thread.rootMoves.end())
                continue;
            moves.push_back(m);
        }
        order_moves(moves, false);
        Line best{-int(VALUE_INFINITE), {}};
        size_t move_index = 0;
        for (Move move : moves) {
            ++move_index;
            if (stopped()) return {};
            Line child;
            {
                Played guard(pos, move);
                child = search(depth-1, prune ? -beta : -int(VALUE_INFINITE),
                               prune ? -alpha : int(VALUE_INFINITE), ply+1);
            }
            if (aborted) return {};
            if (-child.score > best.score) {
                best.score = -child.score;
                best.pv = {move};
                best.pv.insert(best.pv.end(), child.pv.begin(), child.pv.end());
            }
            alpha = std::max(alpha, best.score);
            if (prune && alpha >= beta) {
                ++cutoffs;
                if (move_index == 1) ++main_first_cutoffs;
                main_skipped_siblings += moves.size() - move_index;
                break;
            }
        }
        return best;
    }
};
} // namespace

void phase0d_search(MainThread& thread) {
    const std::string mode = std::string(Options["Phase0Search"]);
    Bridge search{thread, thread.rootPos, mode == "alphabeta", bool(Options["Phase0Audit"])};
    search.use_qsearch = bool(Options["Phase0QSearch"]);
    search.qdepth = int(Options["Phase0QDepth"]);
    search.tactical_order = Options["Phase0MoveOrder"] == "tactical";
    auto& pos = thread.rootPos;
    const auto initial_sfen = pos.sfen();
    const auto initial_key = pos.key();
    const auto initial_state = pos.state();
    const int initial_eval = Eval::evaluate(pos);
    thread.completedDepth = 0;
    drawValueTable[REPETITION_DRAW][BLACK] = VALUE_ZERO;
    drawValueTable[REPETITION_DRAW][WHITE] = VALUE_ZERO;
    Move fallback = MOVE_RESIGN;
    for (auto& root : thread.rootMoves) {
        if (root.pv.front() != MOVE_WIN &&
            (fallback == MOVE_RESIGN || to_usi_string(root.pv.front()) < to_usi_string(fallback)))
            fallback = root.pv.front();
    }
    const int ceiling = search.use_qsearch ? 2 : 3;
    const int requested = Search::Limits.depth ? Search::Limits.depth : ceiling;
    const int target = std::min(requested, ceiling);
    Line committed;
    bool has_result = false;
    if (Threads.size() != 1 || thread.ponder || Search::Limits.mate ||
        Search::Limits.enteringKingRule != EKR_NONE || !Search::Limits.generate_all_legal_moves) {
        search.aborted = true; search.reason = "unsupported_pilot_settings";
    }
    for (int depth = 1; depth <= target && !search.aborted; ++depth) {
        auto result = search.search(depth, -int(VALUE_INFINITE), int(VALUE_INFINITE), 0);
        if (search.aborted) break;
        committed = std::move(result); has_result = true;
        thread.completedDepth = depth;
        std::ostringstream line;
        line << "info depth " << depth << " seldepth " << search.max_ply
             << " nodes " << thread.nodes << " time " << int(search.elapsed())
             << " score " << USI::value(Value(committed.score)) << " pv";
        for (Move move : committed.pv) line << ' ' << to_usi_string(move);
        sync_cout << line.str() << sync_endl;
    }
    // Check the actual search Position, not only the separate USI input position.
    const int restored_incremental = Eval::evaluate(pos);
    const int restored_full = Eval::compute_eval(pos);
    const bool restored = pos.sfen() == initial_sfen && pos.key() == initial_key
        && pos.state() == initial_state && restored_incremental == initial_eval && restored_full == initial_eval;
    if (!restored) { search.reason = "root_restore_failure"; search.aborted = true; }
    const double search_ms = search.elapsed();
    std::ostringstream record;
    record << "info string phase0d_result {\"mode\":\"" << mode << "\",\"requested_depth\":" << requested
           << ",\"target_depth\":" << target << ",\"completed_depth\":" << thread.completedDepth
           << ",\"nodes\":" << thread.nodes << ",\"visits\":" << search.visits
           << ",\"seldepth\":" << search.max_ply << ",\"leaves\":" << search.leaves
           << ",\"eval_calls\":" << search.eval_calls << ",\"eval_checks\":" << search.eval_checks
           << ",\"eval_mismatches\":" << search.mismatches << ",\"cutoffs\":" << search.cutoffs
           << ",\"qsearch\":" << (search.use_qsearch ? "true" : "false") << ",\"qdepth\":" << search.qdepth
           << ",\"move_order\":\"" << (search.tactical_order ? "tactical" : "lexical") << "\""
           << ",\"main_order_changes\":" << search.main_order_changes
           << ",\"q_order_changes\":" << search.q_order_changes
           << ",\"main_first_cutoffs\":" << search.main_first_cutoffs
           << ",\"q_first_cutoffs\":" << search.q_first_cutoffs
           << ",\"main_skipped_siblings\":" << search.main_skipped_siblings
           << ",\"q_skipped_siblings\":" << search.q_skipped_siblings
           << ",\"qnodes\":" << search.qnodes << ",\"qchecked\":" << search.qchecked
           << ",\"qcheck_beyond_budget\":" << search.qcheck_beyond_budget << ",\"qevasion_edges\":" << search.qevasions
           << ",\"qcapture_edges\":" << search.qcaptures << ",\"qpromotion_edges\":" << search.qpromotions
           << ",\"qstand_cutoffs\":" << search.qstand_cutoffs << ",\"qchild_cutoffs\":" << search.qchild_cutoffs
           << ",\"qdepth_returns\":" << search.qdepth_returns << ",\"qaborts\":" << search.qaborts
           << ",\"first_qcapture_sfen\":\"" << search.first_qcapture_sfen << "\""
           << ",\"first_qcheck_sfen\":\"" << search.first_qcheck_sfen << "\""
           << ",\"search_ms\":" << search_ms << ",\"root_restored\":" << (restored ? "true" : "false")
           << ",\"initial_raw_eval\":" << initial_eval << ",\"restored_raw_eval\":" << restored_incremental
           << ",\"has_result\":" << (has_result ? "true" : "false") << ",\"score_raw\":";
    if (has_result) record << committed.score; else record << "null";
    record << ",\"stop_reason\":\"" << search.reason << "\",\"pv\":[";
    for (size_t i = 0; i < committed.pv.size(); ++i) {
        if (i) record << ',';
        record << '"' << to_usi_string(committed.pv[i]) << '"';
    }
    record << "]}";
    sync_cout << record.str() << sync_endl;
    // The pilot has a hard depth ceiling even for infinite; USI still waits for stop.
    while (Search::Limits.infinite && !Threads.stop)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    const Move best = !committed.pv.empty() && restored ? committed.pv.front() : fallback;
    sync_cout << "bestmove " << to_usi_string(best) << sync_endl;
}
