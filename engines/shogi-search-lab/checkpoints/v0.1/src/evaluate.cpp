#include "lab.hpp"

namespace lab {
int piece_value(PieceType type) {
    // Research baseline: one pawn = 100. Values are hand-set, not trained.
    constexpr int values[16] = {0,100,300,320,450,800,1000,550,0,550,550,550,550,1000,1200,0};
    return values[static_cast<int>(type)];
}

int evaluate(const Board& board) {
    int score = 0;
    for (int i = 0; i < 81; ++i) {
        const Piece p = board.pos.piece_on(static_cast<Square>(i));
        if (p != NO_PIECE) score += (color_of(p) == BLACK ? 1 : -1) * piece_value(type_of(p));
    }
    for (Color side : {BLACK, WHITE})
        for (int p = 1; p <= 7; ++p)
            score += (side == BLACK ? 1 : -1) * hand_count(board.pos.hand_of(side), static_cast<PieceType>(p)) * piece_value(static_cast<PieceType>(p));
    return board.pos.side_to_move() == BLACK ? score : -score;
}

int ordering_score(const Board& board, Move move) {
    const Piece captured = board.pos.piece_on(to_sq(move));
    const PieceType attacker = is_drop(move) ? move_dropped_piece(move) : type_of(board.pos.piece_on(from_sq(move)));
    const int capture_gain = captured == NO_PIECE ? 0 : piece_value(type_of(captured)) + piece_value(raw_type_of(captured));
    const int promotion_gain = is_promote(move) ? piece_value(static_cast<PieceType>(static_cast<int>(attacker) + 8)) - piece_value(attacker) : 0;
    return capture_gain || promotion_gain ? 32 * (capture_gain + promotion_gain) - piece_value(attacker) : 0;
}
}
