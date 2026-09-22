#include "session.hpp"
#include <algorithm>
#include <iostream>
#include <sstream>
#include <stdexcept>

namespace lab {
int session_cli(const std::string& sfen, const std::string& moves, const Options& defaults, uint64_t capacity) {
    TreeSession session(sfen, moves, capacity);
    std::cout << "{\"event\":\"ready\",\"capacity\":" << capacity << ",\"position\":" << view_json(session.show()) << "}\n" << std::flush;
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            std::istringstream input(line);
            std::string command, extra;
            if (!(input >> command)) continue;
            if (command == "go") {
                Options options = defaults;
                // An unqualified go continues one level beyond retained analysis.
                options.depth = std::min(8, std::max(defaults.depth, session.show().completed_depth + 1));
                std::string key, text;
                while (input >> key) {
                    if (!(input >> text) || text.empty() || text.size() > 12 || text.find_first_not_of("0123456789") != std::string::npos)
                        throw std::invalid_argument("go syntax: go [depth 1..8] [time MS] [nodes N]");
                    const uint64_t value = std::stoull(text);
                    if (key == "depth") {
                        if (value < 1 || value > 8) throw std::invalid_argument("Depth must be 1..8");
                        options.depth = static_cast<int>(value);
                    } else if (key == "time") {
                        if (value > 3600000) throw std::invalid_argument("Time must be <= 3600000 ms");
                        options.time_ms = value;
                    } else if (key == "nodes") options.max_nodes = value;
                    else throw std::invalid_argument("Unknown go option: " + key);
                }
                std::cout << session_json(session.analyze(options)) << '\n';
            } else if (command == "play" || command == "advance") {
                std::string move;
                if (!(input >> move) || (input >> extra)) throw std::invalid_argument("play requires one USI move");
                const auto advanced = session.play(move);
                if (command == "advance") std::cout << advance_json(advanced) << '\n';
                else {
                    Options continued = defaults;
                    continued.depth = std::min(8, std::max(defaults.depth, advanced.view.completed_depth + 1));
                    if (!continued.time_ms) continued.time_ms = 200;
                    const auto result = session.analyze(continued);
                    std::cout << "{\"event\":\"played_and_searched\",\"advance\":" << advance_json(advanced)
                              << ",\"analysis\":" << session_json(result) << "}\n";
                }
            } else if (command == "show" || command == "clear" || command == "quit") {
                if (input >> extra) throw std::invalid_argument("Unexpected argument");
                if (command == "quit") {std::cout << "{\"event\":\"bye\"}\n" << std::flush; return 0;}
                if (command == "clear") session.clear_tree();
                std::cout << "{\"event\":" << quote(command) << ",\"position\":" << view_json(session.show()) << "}\n";
            } else throw std::invalid_argument("Commands: go, play, advance, show, clear, quit");
        } catch (const std::exception& e) {
            std::cout << "{\"event\":\"error\",\"error\":" << quote(e.what()) << "}\n";
        }
        std::cout << std::flush;
    }
    return 0;
}
}
