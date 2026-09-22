#pragma once
#include "lab.hpp"
namespace lab {
constexpr size_t positional_size=38;
using PositionalFeatures=std::array<int,positional_size>;
const std::array<const char*,positional_size>& positional_names();
PositionalFeatures positional_features(const Board& board); // Black minus white.
class Evaluator {
    std::string mode_;
    std::array<double,positional_size> weights_{};
public:
    explicit Evaluator(const std::string& mode="material",const std::string& model="");
    int operator()(const Board& board) const;
    const std::array<double,positional_size>& weights() const {return weights_;}
};
int positional_selftest();
}
