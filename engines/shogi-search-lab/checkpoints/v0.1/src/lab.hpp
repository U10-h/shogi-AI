#pragma once
#include "position.h"
#include <array>
#include <cstdint>
#include <deque>
#include <fstream>
#include <optional>
#include <string>
#include <vector>

namespace lab {
constexpr int infinity = 1000000;
constexpr int mate = 100000;
std::string usi(Move move);
std::string quote(const std::string& s);

struct Snapshot {
    Key key;
    std::array<uint8_t, 81> squares{};
    std::array<Hand, 2> hands{};
    Color side;
    bool check;
    bool same_position(const Snapshot& other) const;
};

class Board {
public:
    Position pos;
    std::deque<StateInfo> input_states;
    std::vector<Snapshot> history;
    explicit Board(const std::string& sfen = SFEN_HIRATE);
    Board(const Board&) = delete;
    Board& operator=(const Board&) = delete;
    std::vector<Move> legal_moves() const;
    void remember();
    void play_input(const std::string& moves);
    std::optional<int> repetition_score(int ply) const;
};

// Every recursive move restores both the board and repetition history, also on abort.
class PlayedMove {
    Board& board;
    Move move;
    StateInfo state;
public:
    PlayedMove(Board& board, Move move);
    ~PlayedMove();
    PlayedMove(const PlayedMove&) = delete;
    PlayedMove& operator=(const PlayedMove&) = delete;
};

int piece_value(PieceType type);
int evaluate(const Board& board);
int ordering_score(const Board& board, Move move);
uint64_t perft(Board& board, int depth);

enum class Algorithm { minimax, alphabeta, ordered };
std::string name(Algorithm algorithm);
struct Options {
    Algorithm algorithm = Algorithm::ordered;
    int depth = 3;
    uint64_t max_nodes = 2000000;
    std::string trace_path;
    uint64_t trace_limit = 20000;
};
struct Result {
    bool complete = false;
    int score = 0;
    uint64_t nodes = 0, leaves = 0, terminals = 0, cutoffs = 0, skipped_siblings = 0;
    double elapsed_ms = 0;
    std::vector<Move> pv;
};
Result search(Board& board, const Options& options);
std::string result_json(const Result& result, const Options& options);
int selftest();
}
