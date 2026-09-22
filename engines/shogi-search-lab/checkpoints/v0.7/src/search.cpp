#include "lab.hpp"
#include <algorithm>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace lab {
std::string name(Algorithm a) {
    if (a == Algorithm::minimax) return "minimax";
    return a == Algorithm::alphabeta ? "alphabeta" : "ordered";
}
namespace {
struct BudgetStop {const char* reason;};
struct NodeResult {int score; std::vector<Move> pv;};
std::string pv_json(const std::vector<Move>& pv) {
    std::string out = "[";
    for (size_t i = 0; i < pv.size(); ++i) {if (i) out += ','; out += quote(usi(pv[i]));}
    return out + ']';
}
class Search {
    Board& board;
    const Options& options;
    std::ofstream trace;
    uint64_t written = 0, omitted = 0;
    double start_ms = 0;
    int current_depth = 0;
    std::vector<Move> previous_pv;
    double now_ms() const {
        if (options.clock_ms) return options.clock_ms();
        return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
    }
    void check_budget() const {
        if (result.nodes >= options.max_nodes) throw BudgetStop{"node_limit"};
        if (options.time_ms && now_ms() - start_ms >= options.time_ms) throw BudgetStop{"time_limit"};
    }
public:
    Result result;
    Search(Board& b, const Options& o) : board(b), options(o) {
        if (!o.trace_path.empty()) {
            trace.open(o.trace_path);
            if (!trace) throw std::runtime_error("Cannot open trace file");
            trace << "{\"event\":\"start\",\"algorithm\":" << quote(name(o.algorithm)) << ",\"depth\":" << o.depth << ",\"iterative\":" << (o.iterative ? "true" : "false") << ",\"pv_order\":" << (o.pv_order ? "true" : "false") << ",\"time_ms\":" << o.time_ms << ",\"score_perspective\":\"side_to_move_at_node\",\"event_limit\":" << o.trace_limit << "}\n";
        }
    }
    void emit(const std::string& event) {
        if (!trace.is_open()) return;
        if (written < options.trace_limit) {trace << event << '\n'; ++written;}
        else ++omitted;
    }
    NodeResult visit(int depth, int alpha, int beta, int ply, uint64_t parent, Move incoming, bool pv_prefix = true) {
        check_budget();
        const uint64_t id = ++result.nodes;
        const int alpha_start = alpha, beta_start = beta;
        if (trace.is_open()) {
            emit("{\"event\":\"enter\",\"id\":" + std::to_string(id) + ",\"parent\":" + std::to_string(parent) + ",\"iteration_depth\":" + std::to_string(current_depth) + ",\"move\":" + quote(usi(incoming)) + ",\"ply\":" + std::to_string(ply) + ",\"depth\":" + std::to_string(depth) + ",\"alpha\":" + std::to_string(alpha) + ",\"beta\":" + std::to_string(beta) + ",\"sfen\":" + quote(board.pos.sfen()) + "}");
        }
        auto finish = [&](NodeResult value, const std::string& reason) {
            if (trace.is_open()) {
                const std::string bound = value.score <= alpha_start ? "upper" : value.score >= beta_start ? "lower" : "exact";
                emit("{\"event\":\"return\",\"id\":" + std::to_string(id) + ",\"score\":" + std::to_string(value.score) + ",\"bound\":" + quote(bound) + ",\"reason\":" + quote(reason) + "}");
            }
            return value;
        };
        if (auto repetition = board.repetition_score(ply)) {
            ++result.terminals;
            return finish({*repetition, {}}, "repetition");
        }
        auto moves = board.legal_moves();
        if (moves.empty()) {
            ++result.terminals;
            return finish({-mate + ply, {}}, "no_legal_move");
        }
        if (depth == 0) {
            ++result.leaves;
            return finish({evaluate(board), {}}, "static_evaluation");
        }
        // A previous PV move is applicable only while the complete path agrees.
        // Nothing is inferred about the value or depth of a different position.
        const Move preferred = options.iterative && options.pv_order && pv_prefix && static_cast<size_t>(ply) < previous_pv.size()
                               ? previous_pv[ply] : MOVE_NONE;
        struct Candidate {Move move; bool preferred; int priority; std::string text;};
        std::vector<Candidate> candidates;
        candidates.reserve(moves.size());
        for (Move move : moves) candidates.push_back({move, move == preferred, options.algorithm == Algorithm::ordered ? ordering_score(board, move) : 0, usi(move)});
        std::sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) {
            if (a.preferred != b.preferred) return a.preferred;
            return a.priority != b.priority ? a.priority > b.priority : a.text < b.text;
        });
        if (candidates.front().preferred) {
            ++result.pv_priority_nodes;
            if (trace.is_open()) emit("{\"event\":\"pv_priority\",\"id\":" + std::to_string(id) + ",\"move\":" + quote(usi(preferred)) + "}");
        }
        NodeResult best{-infinity, {}};
        for (size_t i = 0; i < candidates.size(); ++i) {
            const Move move = candidates[i].move;
            NodeResult child;
            {
                PlayedMove played(board, move);
                child = visit(depth - 1, options.algorithm == Algorithm::minimax ? -infinity : -beta,
                              options.algorithm == Algorithm::minimax ? infinity : -alpha, ply + 1, id, move, pv_prefix && move == preferred);
            }
            const int score = -child.score;
            if (score > best.score) {
                best.score = score;
                best.pv = {move};
                best.pv.insert(best.pv.end(), child.pv.begin(), child.pv.end());
            }
            if (options.algorithm != Algorithm::minimax) {
                alpha = std::max(alpha, score);
                if (alpha >= beta) {
                    ++result.cutoffs;
                    result.skipped_siblings += candidates.size() - i - 1;
                    if (trace.is_open()) {
                        std::string skipped = "[";
                        for (size_t j = i + 1; j < candidates.size(); ++j) {if (j > i + 1) skipped += ','; skipped += quote(candidates[j].text);}
                        emit("{\"event\":\"cutoff\",\"id\":" + std::to_string(id) + ",\"move\":" + quote(usi(move)) + ",\"alpha\":" + std::to_string(alpha) + ",\"beta\":" + std::to_string(beta) + ",\"lower_bound\":" + std::to_string(best.score) + ",\"skipped_moves\":" + skipped + "],\"reason\":\"alpha_ge_beta\"}");
                    }
                    break;
                }
            }
        }
        return finish(best, "searched");
    }
    void run() {
        start_ms = now_ms();
        const int first_depth = options.iterative && options.depth > 0 ? 1 : options.depth;
        try {
            for (current_depth = first_depth; current_depth <= options.depth; ++current_depth) {
                const uint64_t nodes_before = result.nodes, priorities_before = result.pv_priority_nodes;
                const double iteration_start = now_ms();
                if (trace.is_open()) emit("{\"event\":\"iteration_start\",\"depth\":" + std::to_string(current_depth) + "}");
                auto root = visit(current_depth, -infinity, infinity, 0, 0, MOVE_NONE);
                // Publish only after the entire root search has returned.
                result.score = root.score;
                result.pv = std::move(root.pv);
                result.has_result = true;
                result.completed_depth = current_depth;
                result.iterations.push_back({current_depth, result.score, result.nodes - nodes_before,
                    result.pv_priority_nodes - priorities_before, now_ms() - iteration_start, result.pv});
                if (trace.is_open()) emit("{\"event\":\"iteration_complete\",\"depth\":" + std::to_string(current_depth) + ",\"score\":" + std::to_string(result.score) + ",\"pv\":" + pv_json(result.pv) + "}");
                previous_pv = result.pv;
                if (current_depth > 0 && result.pv.empty()) {
                    result.complete = true;
                    result.stop_reason = "terminal";
                    break;
                }
                if (current_depth == options.depth) {
                    result.complete = true;
                    result.stop_reason = "depth_limit";
                }
            }
        } catch (const BudgetStop& stop) {
            result.stop_reason = stop.reason;
            if (trace.is_open()) emit("{\"event\":\"iteration_abort\",\"depth\":" + std::to_string(current_depth) + ",\"reason\":" + quote(stop.reason) + "}");
            // Preserve the last completed iteration; discard the partial one.
        }
        result.elapsed_ms = now_ms() - start_ms;
        if (trace.is_open()) trace << "{\"event\":\"end\",\"complete\":" << (result.complete ? "true" : "false") << ",\"has_result\":" << (result.has_result ? "true" : "false") << ",\"completed_depth\":" << result.completed_depth << ",\"stop_reason\":" << quote(result.stop_reason) << ",\"nodes\":" << result.nodes << ",\"omitted_events\":" << omitted << "}\n";
    }
};
}

Result search(Board& board, const Options& options) {
    if (options.depth < 0 || options.depth > 8 || options.max_nodes == 0 || options.time_ms > 3600000) throw std::invalid_argument("Invalid search limits");
    Search worker(board, options);
    worker.run();
    return worker.result;
}

std::string result_json(const Result& r, const Options& o) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(3);
    out << "{\"algorithm\":" << quote(name(o.algorithm)) << ",\"depth\":" << o.depth << ",\"complete\":" << (r.complete ? "true" : "false")
        << ",\"iterative\":" << (o.iterative ? "true" : "false") << ",\"pv_order\":" << (o.pv_order ? "true" : "false")
        << ",\"has_result\":" << (r.has_result ? "true" : "false") << ",\"completed_depth\":" << r.completed_depth << ",\"stop_reason\":" << quote(r.stop_reason)
        << ",\"score\":" << (r.has_result ? std::to_string(r.score) : "null") << ",\"bestmove\":" << (r.pv.empty() ? "null" : quote(usi(r.pv.front())))
        << ",\"nodes\":" << r.nodes << ",\"leaves\":" << r.leaves << ",\"terminals\":" << r.terminals << ",\"cutoffs\":" << r.cutoffs
        << ",\"skipped_siblings\":" << r.skipped_siblings << ",\"elapsed_ms\":" << r.elapsed_ms << ",\"pv_priority_nodes\":" << r.pv_priority_nodes
        << ",\"pv\":" << pv_json(r.pv) << ",\"iterations\":[";
    for (size_t i = 0; i < r.iterations.size(); ++i) {
        if (i) out << ',';
        const auto& it = r.iterations[i];
        out << "{\"depth\":" << it.depth << ",\"score\":" << it.score << ",\"nodes\":" << it.nodes << ",\"elapsed_ms\":" << it.elapsed_ms
            << ",\"pv_priority_nodes\":" << it.pv_priority_nodes << ",\"pv\":" << pv_json(it.pv) << '}';
    }
    out << "]}";
    return out.str();
}
}
