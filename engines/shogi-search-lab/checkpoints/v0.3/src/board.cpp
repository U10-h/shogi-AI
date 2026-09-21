#include "lab.hpp"
#include <algorithm>
#include <cctype>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace lab {
namespace {
int raw_index(char c) {
    const std::string symbols = "PLNSBRGK";
    auto i = symbols.find(static_cast<char>(std::toupper(static_cast<unsigned char>(c))));
    if (i == std::string::npos) throw std::invalid_argument("Unknown SFEN piece");
    return static_cast<int>(i) + 1;
}
// This checks parser preconditions and piece inventory, not historical reachability.
void validate_sfen(const std::string& sfen) {
    std::istringstream in(sfen);
    std::string board, side, hands, number, extra;
    if (!(in >> board >> side >> hands >> number) || (in >> extra))
        throw std::invalid_argument("SFEN requires exactly four fields");
    if (side != "b" && side != "w") throw std::invalid_argument("Invalid SFEN side");
    if (number.empty() || number.size() > 8 || !std::all_of(number.begin(), number.end(), [](unsigned char c){return std::isdigit(c);}) || std::stoul(number) < 1)
        throw std::invalid_argument("Invalid SFEN move number");
    int file = 0, rank = 0;
    bool promoted = false;
    std::array<int, 9> count{};
    int black_kings = 0, white_kings = 0;
    for (char c : board) {
        if (c == '/') {
            if (file != 9 || promoted || ++rank > 8) throw std::invalid_argument("Invalid SFEN rank");
            file = 0;
        } else if (c == '+') {
            if (promoted) throw std::invalid_argument("Invalid promotion marker");
            promoted = true;
        } else if (c >= '1' && c <= '9') {
            if (promoted) throw std::invalid_argument("Promotion before empty square");
            file += c - '0';
        } else {
            const int type = raw_index(c);
            if (promoted && type >= 7) throw std::invalid_argument("Gold/king cannot promote");
            ++count[type];
            if (c == 'K') ++black_kings;
            if (c == 'k') ++white_kings;
            ++file;
            promoted = false;
        }
        if (file > 9) throw std::invalid_argument("SFEN rank too wide");
    }
    if (file != 9 || rank != 8 || promoted || black_kings != 1 || white_kings != 1)
        throw std::invalid_argument("SFEN must have nine ranks and one king per side");
    if (hands != "-") {
        int n = 0;
        std::string seen;
        for (char c : hands) {
            if (std::isdigit(static_cast<unsigned char>(c))) {
                if ((n == 0 && c == '0') || n > 18) throw std::invalid_argument("Invalid hand count");
                n = 10 * n + c - '0';
            } else {
                const int type = raw_index(c);
                if (type == 8 || seen.find(c) != std::string::npos) throw std::invalid_argument("Invalid hand piece");
                seen += c;
                count[type] += n ? n : 1;
                n = 0;
            }
        }
        if (n) throw std::invalid_argument("Missing hand piece");
    }
    constexpr int maximum[] = {0,18,4,4,4,2,2,4,2};
    for (int i = 1; i <= 8; ++i)
        if (count[i] > maximum[i]) throw std::invalid_argument("Too many pieces in SFEN");
}
}

std::string usi(Move move) {
    if (move == MOVE_NONE) return "none";
    auto square = [](Square s) {
        std::string out;
        out += static_cast<char>('1' + file_of(s));
        out += static_cast<char>('a' + rank_of(s));
        return out;
    };
    if (is_drop(move)) return std::string(1, " PLNSBRGK"[move_dropped_piece(move)]) + "*" + square(to_sq(move));
    return square(from_sq(move)) + square(to_sq(move)) + (is_promote(move) ? "+" : "");
}

std::string quote(const std::string& s) {
    std::string out = "\"";
    for (unsigned char c : s) {
        if (c == '\\' || c == '"') {out += '\\'; out += c;}
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else if (c < 32) out += '?';
        else out += c;
    }
    return out + '"';
}

bool Snapshot::same_position(const Snapshot& other) const {
    return key == other.key && side == other.side && squares == other.squares && hands == other.hands;
}

Board::Board(const std::string& sfen) {
    validate_sfen(sfen);
    input_states.emplace_back();
    pos.set(sfen, &input_states.back(), nullptr);
    if (pos.attackers_to(pos.side_to_move(), pos.king_square(~pos.side_to_move())))
        throw std::invalid_argument("Non-moving king is already in check");
    remember();
}

void Board::remember() {
    Snapshot s;
    s.key = pos.key();
    s.side = pos.side_to_move();
    s.check = pos.in_check();
    for (int i = 0; i < 81; ++i) s.squares[i] = static_cast<uint8_t>(pos.piece_on(static_cast<Square>(i)));
    s.hands = {pos.hand_of(BLACK), pos.hand_of(WHITE)};
    history.push_back(s);
}

std::vector<Move> Board::legal_moves() const {
    std::vector<Move> moves;
    for (auto entry : MoveList<LEGAL_ALL>(pos)) moves.push_back(entry.move);
    return moves;
}

void Board::play_input(const std::string& moves) {
    std::istringstream input(moves);
    std::string token;
    while (input >> token) {
        if (repetition_score(0).has_value()) throw std::invalid_argument("Move after repetition terminal");
        auto legal = legal_moves();
        auto found = std::find_if(legal.begin(), legal.end(), [&](Move m){return usi(m) == token;});
        if (found == legal.end()) throw std::invalid_argument("Illegal move: " + token);
        input_states.emplace_back();
        pos.do_move(*found, input_states.back());
        remember();
    }
}

std::optional<int> Board::repetition_score(int ply) const {
    const Snapshot& current = history.back();
    int matches = 0;
    size_t first = 0;
    for (size_t i = history.size(); i-- > 0;) {
        if (current.same_position(history[i]) && ++matches == 4) {first = i; break;}
    }
    if (matches < 4) return std::nullopt;
    // Post-move states store whether the opponent is in check. A side loses
    // if all its moves in the repeating interval continuously gave check.
    for (Color checker : {BLACK, WHITE}) {
        bool moved = false, continuous = true;
        for (size_t i = first + 1; i < history.size(); ++i) {
            if (history[i].side != checker) {
                moved = true;
                if (!history[i].check) continuous = false;
            }
        }
        if (moved && continuous) return checker == current.side ? -mate + ply : mate - ply;
    }
    return 0;
}

PlayedMove::PlayedMove(Board& b, Move m) : board(b), move(m) {
    board.pos.do_move(move, state);
    board.remember();
}
PlayedMove::~PlayedMove() {
    board.history.pop_back();
    board.pos.undo_move(move);
}

uint64_t perft(Board& board, int depth) {
    if (depth == 0) return 1;
    uint64_t total = 0;
    for (Move move : board.legal_moves()) {
        PlayedMove played(board, move);
        total += perft(board, depth - 1);
    }
    return total;
}
}
