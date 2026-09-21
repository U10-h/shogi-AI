#include "session.hpp"
#include <algorithm>
#include <chrono>
#include <iomanip>
#include <map>
#include <sstream>
#include <stdexcept>

namespace lab {
namespace {
enum class Bound { exact, lower, upper };
struct Entry {
    int score = 0; // Mate scores are relative to THIS node, not the old root.
    Bound bound = Bound::exact;
    std::vector<Move> pv;
    bool terminal = false;
};
struct Budget {const char* reason;};
int local_score(int score, int ply) {
    return score > 90000 ? score + ply : score < -90000 ? score - ply : score;
}
int root_score(int score, int ply) {
    return score > 90000 ? score - ply : score < -90000 ? score + ply : score;
}
std::string pv_json(const std::vector<Move>& pv) {
    std::string out = "[";
    for (size_t i = 0; i < pv.size(); ++i) {if (i) out += ','; out += quote(usi(pv[i]));}
    return out + ']';
}
}

struct TreeSession::Impl {
    struct Node {
        uint64_t& live;
        uint64_t id;
        std::optional<Snapshot> position;
        std::array<std::optional<Entry>, 9> entries;
        // Only nodes that have been an actual analysis root receive rankings.
        std::map<int, std::vector<CandidateLine>> rankings;
        std::map<Move, std::unique_ptr<Node>> children;
        Node(uint64_t& live, uint64_t id) : live(live), id(id) {++live;}
        ~Node() {--live;}
    };
    Board board;
    uint64_t live = 0, next_id = 0, capacity;
    std::unique_ptr<Node> root;
    Options options;
    SessionResult work;
    double started = 0;

    Impl(const std::string& sfen, const std::string& moves, uint64_t cap) : board(sfen), capacity(cap) {
        if (cap < 32 || cap > 200000) throw std::invalid_argument("Tree capacity must be 32..200000");
        board.play_input(moves);
        root = make_node();
    }
    std::unique_ptr<Node> make_node() {return std::make_unique<Node>(live, ++next_id);}
    double now() const {
        if (options.clock_ms) return options.clock_ms();
        return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
    }
    void tick() {
        if (work.nodes >= options.max_nodes) throw Budget{"node_limit"};
        if (options.time_ms && now() - started >= options.time_ms) throw Budget{"time_limit"};
        ++work.nodes;
    }
    void bind(Node* node) {
        if (!node) return;
        if (!node->position) node->position = board.history.back();
        else if (!node->position->same_position(board.history.back()))
            throw std::logic_error("Retained tree does not match current position");
    }
    Node* child(Node* node, Move move) {
        if (!node) return nullptr;
        auto found = node->children.find(move);
        if (found != node->children.end()) return found->second.get();
        if (live >= capacity) {++work.capacity_misses; return nullptr;}
        auto new_node = make_node();
        auto* pointer = new_node.get();
        node->children.emplace(move, std::move(new_node));
        return pointer;
    }
    std::vector<Move> order(std::vector<Move> moves, Node* node) {
        Move preferred = MOVE_NONE;
        if (node) for (int d = 8; d >= 0; --d) {
            if (node->entries[d] && !node->entries[d]->pv.empty()) {preferred = node->entries[d]->pv.front(); break;}
        }
        struct Item {Move move; bool preferred; int value; std::string text;};
        std::vector<Item> items;
        for (Move m : moves) items.push_back({m, m == preferred, ordering_score(board, m), usi(m)});
        std::sort(items.begin(), items.end(), [](const Item& a, const Item& b) {
            if (a.preferred != b.preferred) return a.preferred;
            return a.value != b.value ? a.value > b.value : a.text < b.text;
        });
        moves.clear();
        for (auto& item : items) moves.push_back(item.move);
        return moves;
    }
    Entry visit(Node* node, int depth, int alpha, int beta, int ply) {
        tick();
        bind(node);
        const int original_alpha = alpha;
        if (node && node->entries[depth]) {
            const auto& stored = *node->entries[depth];
            const int score = root_score(stored.score, ply);
            if (stored.bound == Bound::exact || (stored.bound == Bound::lower && score >= beta) || (stored.bound == Bound::upper && score <= alpha)) {
                stored.bound == Bound::exact ? ++work.exact_hits : ++work.bound_hits;
                auto found = stored;
                found.score = score;
                return found;
            }
        }
        auto finish = [&](Entry result) {
            result.bound = result.score <= original_alpha ? Bound::upper : result.score >= beta ? Bound::lower : Bound::exact;
            if (node) {
                auto stored = result;
                stored.score = local_score(result.score, ply);
                node->entries[depth] = std::move(stored);
            }
            return result;
        };
        if (auto repetition = board.repetition_score(ply)) return finish({*repetition, Bound::exact, {}, true});
        auto moves = board.legal_moves();
        if (moves.empty()) return finish({-mate + ply, Bound::exact, {}, true});
        if (!depth) return finish({evaluate(board), Bound::exact, {}, false});
        moves = order(std::move(moves), node);
        Entry best{-infinity, Bound::exact, {}, false};
        for (Move move : moves) {
            Node* next = child(node, move);
            Entry result;
            {
                PlayedMove played(board, move);
                result = visit(next, depth - 1, -beta, -alpha, ply + 1);
            }
            const int score = -result.score;
            if (score > best.score) {
                best.score = score;
                best.pv = {move};
                best.pv.insert(best.pv.end(), result.pv.begin(), result.pv.end());
            }
            alpha = std::max(alpha, score);
            if (alpha >= beta) {++work.cutoffs; break;}
        }
        return finish(best);
    }
    void retain_five(const std::vector<CandidateLine>& lines, int depth) {
        // All legal moves were compared. Keep the chosen subtrees and release
        // the others, which remain eligible for the next deeper iteration.
        for (auto it = root->children.begin(); it != root->children.end();) {
            if (std::none_of(lines.begin(), lines.end(), [&](const auto& line){return line.move == it->first;})) it = root->children.erase(it);
            else ++it;
        }
        for (const auto& line : lines) {
            if (!root->children.count(line.move)) {
                // Reserve the five branch roots even when the detail cache is full.
                if (live >= capacity) for (auto& [move, node] : root->children) {
                    if (!node->children.empty()) {node->children.clear(); break;}
                }
                root->children.emplace(line.move, make_node());
            }
            Entry value{local_score(-line.score, 1), Bound::exact, {}, line.child_terminal};
            value.pv.assign(line.pv.begin() + 1, line.pv.end());
            auto& entry = root->children.at(line.move)->entries[depth - 1];
            entry = std::move(value);
        }
        if (live > capacity) throw std::logic_error("Tree capacity exceeded");
    }
    void rank_root(int depth) {
        tick();
        bind(root.get());
        if (auto repetition = board.repetition_score(0)) {
            root->entries[depth] = Entry{*repetition, Bound::exact, {}, true};
            root->rankings[depth] = {};
            root->children.clear();
            return;
        }
        auto legal = board.legal_moves();
        if (legal.empty()) {
            root->entries[depth] = Entry{-mate, Bound::exact, {}, true};
            root->rankings[depth] = {};
            root->children.clear();
            return;
        }
        auto moves = order(std::move(legal), root.get());
        std::vector<CandidateLine> lines;
        for (Move move : moves) {
            Node* next = child(root.get(), move);
            Entry value;
            {
                PlayedMove played(board, move);
                // Every root candidate receives an exact full-window value.
                value = visit(next, depth - 1, -infinity, infinity, 1);
            }
            CandidateLine line{move, -value.score, depth, {move}, value.terminal};
            line.pv.insert(line.pv.end(), value.pv.begin(), value.pv.end());
            lines.push_back(std::move(line));
        }
        std::sort(lines.begin(), lines.end(), [](const auto& a, const auto& b) {
            return a.score != b.score ? a.score > b.score : usi(a.move) < usi(b.move);
        });
        if (lines.size() > 5) lines.resize(5);
        // Publish one coherent ranking only when all legal root moves finished.
        retain_five(lines, depth);
        root->entries[depth] = Entry{lines[0].score, Bound::exact, lines[0].pv, false};
        root->rankings[depth] = std::move(lines);
    }
    SessionView view(int limit = 8) const {
        SessionView v;
        v.root_id = root->id;
        v.tree_nodes = live;
        v.sfen = board.pos.sfen();
        v.history_positions = board.history.size();
        for (int d = limit; d >= 0; --d) {
            if (!root->entries[d] || root->entries[d]->bound != Bound::exact) continue;
            const auto& entry = *root->entries[d];
            v.has_result = true;
            v.completed_depth = d;
            v.score = entry.score;
            v.pv = entry.pv;
            v.terminal = entry.terminal;
            auto found = root->rankings.find(d);
            v.candidates_complete = found != root->rankings.end();
            if (v.candidates_complete) {
                v.candidates = found->second;
                for (auto& line : v.candidates) {
                    auto child = root->children.find(line.move);
                    v.candidate_node_ids.push_back(child == root->children.end() ? 0 : child->second->id);
                }
            }
            break;
        }
        return v;
    }
};

TreeSession::TreeSession(const std::string& sfen, const std::string& moves, uint64_t cap) : impl(std::make_unique<Impl>(sfen, moves, cap)) {}
TreeSession::~TreeSession() = default;
SessionView TreeSession::show() const {return impl->view();}
void TreeSession::clear_tree() {
    impl->root.reset();
    impl->root = impl->make_node();
}
SessionResult TreeSession::analyze(const Options& options) {
    if (options.depth < 1 || options.depth > 8 || !options.max_nodes || options.time_ms > 3600000)
        throw std::invalid_argument("Session depth must be 1..8 with valid budgets");
    auto& s = *impl;
    if (s.view().completed_depth > options.depth)
        throw std::invalid_argument("Session deepens monotonically; use clear before requesting a shallower depth");
    s.options = options;
    s.work = {};
    s.work.requested_depth = options.depth;
    s.started = s.now();
    try {
        for (int depth = 1; depth <= options.depth; ++depth) {
            auto cached = s.root->rankings.find(depth);
            if (cached != s.root->rankings.end()) {
                ++s.work.ranking_hits;
            } else s.rank_root(depth);
            s.work.completed_iterations.push_back(depth);
            if (s.root->entries[depth]->terminal) {s.work.complete = true; s.work.stop_reason = "terminal"; break;}
            if (depth == options.depth) {s.work.complete = true; s.work.stop_reason = "depth_limit";}
        }
    } catch (const Budget& stop) {s.work.stop_reason = stop.reason;}
    const auto latest = s.view(options.depth);
    if (latest.candidates_complete && !latest.candidates.empty()) s.retain_five(latest.candidates, latest.completed_depth);
    s.work.elapsed_ms = s.now() - s.started;
    s.work.view = s.view(options.depth);
    return s.work;
}
AdvanceResult TreeSession::play(const std::string& move_text) {
    if (move_text.find_first_of(" \t\n\r") != std::string::npos) throw std::invalid_argument("play accepts one USI move");
    auto& s = *impl;
    auto legal = s.board.legal_moves();
    auto found = std::find_if(legal.begin(), legal.end(), [&](Move m){return usi(m) == move_text;});
    if (found == legal.end() || s.board.repetition_score(0)) throw std::invalid_argument("Illegal move or terminal position");
    const Move move = *found;
    AdvanceResult out;
    out.previous_root_id = s.root->id;
    const auto before = s.view();
    for (size_t i = 0; i < before.candidates.size(); ++i) if (before.candidates[i].move == move) out.previous_rank = static_cast<int>(i) + 1;
    // Validate before mutating the retained tree; Board preserves full history.
    s.board.play_input(move_text);
    auto branch = s.root->children.find(move);
    if (branch != s.root->children.end()) {
        auto next = std::move(branch->second);
        s.root = std::move(next);
        out.reused_tree = true;
    } else {
        s.root.reset();
        s.root = s.make_node();
    }
    s.bind(s.root.get());
    out.view = s.view();
    return out;
}

std::string view_json(const SessionView& v) {
    std::ostringstream out;
    out << "{\"sfen\":" << quote(v.sfen) << ",\"history_positions\":" << v.history_positions << ",\"root_id\":" << v.root_id
        << ",\"tree_nodes\":" << v.tree_nodes << ",\"retained_top_k\":5,\"has_result\":" << (v.has_result ? "true" : "false")
        << ",\"candidates_complete\":" << (v.candidates_complete ? "true" : "false") << ",\"terminal\":" << (v.terminal ? "true" : "false")
        << ",\"completed_depth\":" << v.completed_depth << ",\"score\":" << (v.has_result ? std::to_string(v.score) : "null")
        << ",\"pv\":" << pv_json(v.pv) << ",\"candidates\":[";
    for (size_t i = 0; i < v.candidates.size(); ++i) {
        if (i) out << ',';
        const auto& c = v.candidates[i];
        out << "{\"rank\":" << i + 1 << ",\"move\":" << quote(usi(c.move)) << ",\"score\":" << c.score << ",\"depth\":" << c.depth
            << ",\"bound\":\"exact\",\"node_id\":" << v.candidate_node_ids[i] << ",\"pv\":" << pv_json(c.pv) << '}';
    }
    out << "]}";
    return out.str();
}
std::string session_json(const SessionResult& r) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(3);
    out << "{\"event\":\"analysis\",\"requested_depth\":" << r.requested_depth << ",\"complete\":" << (r.complete ? "true" : "false")
        << ",\"stop_reason\":" << quote(r.stop_reason) << ",\"nodes\":" << r.nodes << ",\"exact_hits\":" << r.exact_hits
        << ",\"bound_hits\":" << r.bound_hits << ",\"ranking_hits\":" << r.ranking_hits << ",\"cutoffs\":" << r.cutoffs
        << ",\"capacity_misses\":" << r.capacity_misses << ",\"elapsed_ms\":" << r.elapsed_ms << ",\"completed_iterations\":[";
    for (size_t i = 0; i < r.completed_iterations.size(); ++i) {if (i) out << ','; out << r.completed_iterations[i];}
    out << "],\"position\":" << view_json(r.view) << '}';
    return out.str();
}
std::string advance_json(const AdvanceResult& r) {
    return "{\"event\":\"played\",\"reused_tree\":" + std::string(r.reused_tree ? "true" : "false") + ",\"previous_rank\":" + std::to_string(r.previous_rank)
           + ",\"previous_root_id\":" + std::to_string(r.previous_root_id) + ",\"position\":" + view_json(r.view) + '}';
}
}
