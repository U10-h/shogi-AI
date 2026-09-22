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
struct BudgetStop {};
struct NodeResult {int score; std::vector<Move> pv;};
class Search {
    Board& board;
    const Options& options;
    std::ofstream trace;
    uint64_t written = 0, omitted = 0;
public:
    Result result;
    Search(Board& b, const Options& o) : board(b), options(o) {
        if (!o.trace_path.empty()) {
            trace.open(o.trace_path);
            if (!trace) throw std::runtime_error("Cannot open trace file");
            trace << "{\"event\":\"start\",\"algorithm\":" << quote(name(o.algorithm)) << ",\"depth\":" << o.depth << ",\"score_perspective\":\"side_to_move_at_node\",\"event_limit\":" << o.trace_limit << "}\n";
        }
    }
    void emit(const std::string& event) {
        if (!trace.is_open()) return;
        if (written < options.trace_limit) {trace << event << '\n'; ++written;}
        else ++omitted;
    }
    NodeResult visit(int depth, int alpha, int beta, int ply, uint64_t parent, Move incoming) {
        if (result.nodes >= options.max_nodes) throw BudgetStop{};
        const uint64_t id = ++result.nodes;
        const int alpha_start = alpha, beta_start = beta;
        if (trace.is_open()) {
            emit("{\"event\":\"enter\",\"id\":" + std::to_string(id) + ",\"parent\":" + std::to_string(parent) + ",\"move\":" + quote(usi(incoming)) + ",\"ply\":" + std::to_string(ply) + ",\"depth\":" + std::to_string(depth) + ",\"alpha\":" + std::to_string(alpha) + ",\"beta\":" + std::to_string(beta) + ",\"sfen\":" + quote(board.pos.sfen()) + "}");
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
        struct Candidate {Move move; int priority; std::string text;};
        std::vector<Candidate> candidates;
        candidates.reserve(moves.size());
        for (Move move : moves) candidates.push_back({move, options.algorithm == Algorithm::ordered ? ordering_score(board, move) : 0, usi(move)});
        std::sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) {
            return a.priority != b.priority ? a.priority > b.priority : a.text < b.text;
        });
        NodeResult best{-infinity, {}};
        for (size_t i = 0; i < candidates.size(); ++i) {
            const Move move = candidates[i].move;
            NodeResult child;
            {
                PlayedMove played(board, move);
                child = visit(depth - 1, options.algorithm == Algorithm::minimax ? -infinity : -beta,
                              options.algorithm == Algorithm::minimax ? infinity : -alpha, ply + 1, id, move);
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
        const auto start = std::chrono::steady_clock::now();
        try {
            auto root = visit(options.depth, -infinity, infinity, 0, 0, MOVE_NONE);
            result.score = root.score;
            result.pv = std::move(root.pv);
            result.complete = true;
        } catch (const BudgetStop&) {
            // No incomplete root result is exposed as a completed search.
        }
        result.elapsed_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        if (trace.is_open()) trace << "{\"event\":\"end\",\"complete\":" << (result.complete ? "true" : "false") << ",\"nodes\":" << result.nodes << ",\"omitted_events\":" << omitted << "}\n";
    }
};
}

Result search(Board& board, const Options& options) {
    if (options.depth < 0 || options.depth > 8 || options.max_nodes == 0) throw std::invalid_argument("Invalid search limits");
    Search worker(board, options);
    worker.run();
    return worker.result;
}

std::string result_json(const Result& r, const Options& o) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(3);
    out << "{\"algorithm\":" << quote(name(o.algorithm)) << ",\"depth\":" << o.depth << ",\"complete\":" << (r.complete ? "true" : "false")
        << ",\"score\":" << (r.complete ? std::to_string(r.score) : "null") << ",\"bestmove\":" << (r.pv.empty() ? "null" : quote(usi(r.pv.front())))
        << ",\"nodes\":" << r.nodes << ",\"leaves\":" << r.leaves << ",\"terminals\":" << r.terminals << ",\"cutoffs\":" << r.cutoffs
        << ",\"skipped_siblings\":" << r.skipped_siblings << ",\"elapsed_ms\":" << r.elapsed_ms << ",\"pv\":[";
    for (size_t i = 0; i < r.pv.size(); ++i) {if (i) out << ','; out << quote(usi(r.pv[i]));}
    out << "]}";
    return out.str();
}
}
