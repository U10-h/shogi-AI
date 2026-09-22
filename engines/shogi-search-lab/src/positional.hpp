#pragma once
#include "lab.hpp"
#include "nnue.hpp"
namespace lab {
constexpr size_t positional_size=38;
using PositionalFeatures=std::array<int,positional_size>;
const std::array<const char*,positional_size>& positional_names();
PositionalFeatures positional_features(const Board& board); // Black minus white.
class Evaluator {
    std::string mode_;
    std::array<double,positional_size> weights_{};
    std::unique_ptr<Nnue> nnue_;
public:
    explicit Evaluator(const std::string& mode="material",const std::string& model="");
    int operator()(const Board& board) const;
    std::array<uint8_t,32> nnue_features(const Board& board) const;
    const std::array<double,positional_size>& weights() const {return weights_;}
    std::map<std::string,uint64_t> stats() const {return nnue_?nnue_->stats():std::map<std::string,uint64_t>{};}
};
}
