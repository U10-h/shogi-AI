#include "lab.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>

int main(int argc, char** argv) {
    try {
        lab::Options options;
        std::string sfen = SFEN_HIRATE, moves;
        bool legal = false, tests = false;
        int perft_depth = -1;
        auto number = [](const std::string& s) -> uint64_t {
            if (s.empty() || s.size() > 12 || s.find_first_not_of("0123456789") != std::string::npos)
                throw std::invalid_argument("Expected a non-negative integer");
            return std::stoull(s);
        };
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            auto value = [&]() -> std::string {
                if (++i >= argc) throw std::invalid_argument("Missing value for " + arg);
                return argv[i];
            };
            if (arg == "--help") {
                std::cout << "shogi-lab [--sfen SFEN] [--moves 'USI USI ...']\n"
                    "  --algorithm minimax|alphabeta|ordered --depth 0..8\n"
                    "  --max-nodes N --trace PATH --trace-limit N\n"
                    "  --legal | --perft 0..4 | --selftest\n"
                    "JSON output. Exit 3: search incomplete. Exit 2: invalid input.\n";
                return 0;
            } else if (arg == "--sfen") sfen = value();
            else if (arg == "--moves") moves = value();
            else if (arg == "--algorithm") {
                const auto a = value();
                if (a == "minimax") options.algorithm = lab::Algorithm::minimax;
                else if (a == "alphabeta") options.algorithm = lab::Algorithm::alphabeta;
                else if (a == "ordered") options.algorithm = lab::Algorithm::ordered;
                else throw std::invalid_argument("Unknown algorithm: " + a);
            } else if (arg == "--depth") {
                const auto n = number(value());
                if (n > 8) throw std::invalid_argument("Depth must be <= 8");
                options.depth = static_cast<int>(n);
            } else if (arg == "--max-nodes") options.max_nodes = number(value());
            else if (arg == "--trace") options.trace_path = value();
            else if (arg == "--trace-limit") options.trace_limit = number(value());
            else if (arg == "--legal") legal = true;
            else if (arg == "--selftest") tests = true;
            else if (arg == "--perft") {
                const auto n = number(value());
                if (n > 4) throw std::invalid_argument("Perft depth must be <= 4");
                perft_depth = static_cast<int>(n);
            } else throw std::invalid_argument("Unknown argument: " + arg);
        }
        Bitboards::init();
        Position::init();
        if (tests) return lab::selftest();
        lab::Board board(sfen);
        board.play_input(moves);
        if (legal) {
            std::vector<std::string> list;
            for (Move m : board.legal_moves()) list.push_back(lab::usi(m));
            std::sort(list.begin(), list.end());
            std::cout << "{\"sfen\":" << lab::quote(board.pos.sfen()) << ",\"material_score\":" << lab::evaluate(board) << ",\"moves\":[";
            for (size_t i = 0; i < list.size(); ++i) {if (i) std::cout << ','; std::cout << lab::quote(list[i]);}
            std::cout << "]}\n";
        } else if (perft_depth >= 0) {
            std::cout << "{\"depth\":" << perft_depth << ",\"perft\":" << lab::perft(board, perft_depth) << "}\n";
        } else {
            auto result = lab::search(board, options);
            std::cout << lab::result_json(result, options) << '\n';
            return result.complete ? 0 : 3;
        }
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "{\"error\":" << lab::quote(e.what()) << "}\n";
        return 2;
    }
}
