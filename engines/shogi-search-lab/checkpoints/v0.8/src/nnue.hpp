#pragma once
#include "lab.hpp"
#include <map>
#include <memory>

namespace lab {
// Fixed YaneuraOu 6.03 K+P 256x2-32-32 format, not HalfKP.
// Inference only: weights are externally supplied, never trained here.
class Nnue {
    struct Impl;
    std::shared_ptr<Impl> impl;
public:
    Nnue(const std::string& path, const std::string& policy);
    int operator()(const Board& board) const;
    std::map<std::string,uint64_t> stats() const;
};
}
