#include "lab.hpp"
#include "session.hpp"
#include "advanced.hpp"
#include "positional.hpp"
#include <algorithm>
#include <iostream>
#include <iomanip>
#include <stdexcept>

int main(int argc, char** argv) {
    try {
        lab::Options options;
        lab::AdvancedOptions advanced_options;
        bool advanced = false, advanced_tests = false, usi_mode = false;
        bool eval_batch=false;
        std::string sfen = SFEN_HIRATE, moves;
        bool legal = false, tests = false;
        bool session = false, session_tests = false;
        uint64_t tree_capacity = 50000;
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
                    "  --iterative [--no-pv-order] [--time-ms 1..3600000]\n"
                    "  --legal | --perft 0..4 | --selftest\n"
                    "  --session [--tree-nodes 32..200000] | --session-selftest\n"
                    "  --root-policy full|screen|full-probe|probe (session; default screen)\n"
                    "  --trace-root-only (session root decisions without recursive events)\n"
                    "  --advanced --preset baseline|exact|tactical|selective\n"
                    "  --features CSV --driver ab|pvs|aspiration|mtdf|sss|dual|rps|erps\n"
                    "  --multipv 1..5 --qdepth 0..16 --extensions 0..8 --tt-entries N\n"
                    "  --probcut-model PATH --aspiration N --advanced-selftest --usi\n"
                    "  --eval material|positional|learned|nnue|nnue-full|nnue-verify [--eval-model PATH] (advanced/USI)\n"
                    "  --eager-eval (ablation: restore redundant static evaluation)\n"
                    "  --legacy-order --full-qmoves --eager-qmoves (v0.9 exact-optimization ablations)\n"
                    "  --eval-batch (stdin: one SFEN per line; output features and evaluation)\n"
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
                if (n > 16) throw std::invalid_argument("Depth must be <= 16 (legacy search <= 8)");
                options.depth = static_cast<int>(n);
            } else if (arg == "--iterative") options.iterative = true;
            else if (arg == "--no-pv-order") options.pv_order = false;
            else if (arg == "--time-ms") {
                options.time_ms = number(value());
                if (!options.time_ms || options.time_ms > 3600000) throw std::invalid_argument("Time budget must be 1..3600000 ms");
            } else if (arg == "--max-nodes") options.max_nodes = number(value());
            else if (arg == "--trace") options.trace_path = value();
            else if (arg == "--trace-root-only") options.trace_search = false;
            else if (arg == "--trace-limit") options.trace_limit = number(value());
            else if (arg == "--legal") legal = true;
            else if (arg == "--selftest") tests = true;
            else if (arg == "--session") session = true;
            else if (arg == "--session-selftest") session_tests = true;
            else if (arg == "--advanced") advanced = true;
            else if (arg == "--advanced-selftest") advanced_tests = true;
            else if (arg == "--usi") usi_mode = true;
            else if (arg == "--eval") advanced_options.evaluation=value();
            else if (arg == "--eval-model") advanced_options.evaluation_model=value();
            else if (arg == "--eager-eval") advanced_options.eager_evaluation=true;
            else if (arg == "--legacy-order") advanced_options.compact_ordering=false;
            else if (arg == "--full-qmoves") advanced_options.direct_qmoves=false;
            else if (arg == "--eager-qmoves") advanced_options.defer_qmoves=false;
            else if (arg == "--eval-batch") eval_batch=true;
            else if (arg == "--preset") {advanced = true;lab::set_advanced_preset(advanced_options,value());}
            else if (arg == "--features") {advanced = true;lab::set_advanced_features(advanced_options,value());}
            else if (arg == "--driver") {advanced = true;advanced_options.driver=value();}
            else if (arg == "--probcut-model") advanced_options.probcut_model=value();
            else if (arg == "--tt-entries") advanced_options.tt_capacity=number(value());
            else if (arg == "--multipv" || arg == "--qdepth" || arg == "--extensions" || arg == "--aspiration") {
                auto n=number(value());if(n>10000)throw std::invalid_argument("Advanced option out of range");
                if(arg=="--multipv")advanced_options.multipv=int(n);
                else if(arg=="--qdepth")advanced_options.qdepth=int(n);
                else if(arg=="--extensions")advanced_options.extension_budget=int(n);
                else advanced_options.aspiration=int(n);
            }
            else if (arg == "--root-policy") {
                const auto policy = value();
                if (policy != "full" && policy != "screen" && policy != "probe" && policy != "full-probe")
                    throw std::invalid_argument("Root policy must be full|screen|full-probe|probe");
                options.top5_screen = policy == "screen" || policy == "probe";
                options.reply_probe = policy == "probe" || policy == "full-probe";
            }
            else if (arg == "--tree-nodes") tree_capacity = number(value());
            else if (arg == "--perft") {
                const auto n = number(value());
                if (n > 4) throw std::invalid_argument("Perft depth must be <= 4");
                perft_depth = static_cast<int>(n);
            } else throw std::invalid_argument("Unknown argument: " + arg);
        }
        Bitboards::init();
        Position::init();
        advanced_options.limits=options;
        if(eval_batch){
            std::cout<<std::setprecision(17);
            lab::Evaluator evaluator(advanced_options.evaluation,advanced_options.evaluation_model);
            std::string input;
            while(std::getline(std::cin,input)){
                lab::Board b(input);
                if(advanced_options.evaluation.rfind("nnue",0)==0){
                    std::cout<<"{\"sfen\":"<<lab::quote(b.pos.sfen())<<",\"score\":"<<evaluator(b)
                        <<",\"score_unit\":\"yaneuraou_raw_pawn90\",\"evaluation\":"<<lab::quote(advanced_options.evaluation)<<"}"<<std::endl;
                    continue;
                }
                auto x=lab::positional_features(b);
                std::cout<<"{\"sfen\":"<<lab::quote(b.pos.sfen())<<",\"score\":"<<evaluator(b)
                    <<",\"material\":"<<lab::evaluate(b)<<",\"names\":[";
                for(size_t i=0;i<x.size();++i){if(i)std::cout<<',';std::cout<<lab::quote(lab::positional_names()[i]);}
                std::cout<<"],\"features\":[";
                for(size_t i=0;i<x.size();++i){if(i)std::cout<<',';std::cout<<x[i];}
                std::cout<<"],\"weights\":[";
                for(size_t i=0;i<x.size();++i){if(i)std::cout<<',';std::cout<<evaluator.weights()[i];}
                std::cout<<"]}"<<std::endl;
            }
            return 0;
        }
        if((!advanced&&!usi_mode)&&advanced_options.evaluation!="material")throw std::invalid_argument("Positional evaluation requires --advanced, --usi, or --eval-batch");
        lab::Evaluator validate_evaluator(advanced_options.evaluation,advanced_options.evaluation_model);
        if(advanced_tests)return lab::advanced_selftest();
        if(usi_mode)return lab::advanced_usi(advanced_options);
        if(session&&advanced)throw std::invalid_argument("Legacy retained-tree session cannot mix advanced policies; use --advanced or --usi");
        if (tests) return lab::selftest();
        if (session_tests) return lab::session_selftest();
        if (session) return lab::session_cli(sfen, moves, options, tree_capacity);
        lab::Board board(sfen);
        board.play_input(moves);
        if (legal) {
            std::vector<std::string> list;
            for (Move m : board.legal_moves()) list.push_back(lab::usi(m));
            std::sort(list.begin(), list.end());
            const auto repetition=board.repetition_score(0);
            std::cout << "{\"sfen\":" << lab::quote(board.pos.sfen()) << ",\"material_score\":" << lab::evaluate(board)
                      << ",\"in_check\":" << (board.pos.in_check()?"true":"false")
                      << ",\"repetition_score\":" << (repetition?std::to_string(*repetition):"null") << ",\"moves\":[";
            for (size_t i = 0; i < list.size(); ++i) {if (i) std::cout << ','; std::cout << lab::quote(list[i]);}
            std::cout << "]}\n";
        } else if (perft_depth >= 0) {
            std::cout << "{\"depth\":" << perft_depth << ",\"perft\":" << lab::perft(board, perft_depth) << "}\n";
        } else {
            if(advanced){auto result=lab::advanced_search(board,advanced_options);std::cout<<lab::advanced_json(result,advanced_options)<<'\n';return result.base.complete?0:3;}
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
