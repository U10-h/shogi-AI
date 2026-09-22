#pragma once
#include "lab.hpp"
#include <array>
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace lab {
// Sparse additive policy, used only for ordering. It supplies no value bounds.
constexpr int policy_dim=25392;
inline std::array<int,10> policy_features(const Board& b,Move m) {
    const Color side=b.pos.side_to_move();
    const int pt=is_drop(m)?16+int(move_dropped_piece(m)):int(type_of(b.pos.piece_on(from_sq(m))));
    auto orient=[&](Square s){return side==BLACK?int(s):80-int(s);};
    const int to=orient(to_sq(m)),from=is_drop(m)?81:orient(from_sq(m));
    auto delta=[](int a,int c){return (a/9-c/9+8)*17+(a%9-c%9+8);};
    const int own=orient(b.pos.king_square(side)),enemy=orient(b.pos.king_square(~side));
    return {pt*81+to,1944+pt*82+from,
        3912+pt*289+(is_drop(m)?144:delta(to,from)),
        10848+pt*16+int(type_of(b.pos.piece_on(to_sq(m)))),
        11232+pt*289+delta(to,enemy),18168+pt*289+delta(to,own),
        25104+pt*2+int(is_promote(m)),25152+pt*2+int(b.pos.gives_check(m)),
        25200+pt*4+std::min(3,b.pos.attackers_to(~side,to_sq(m)).pop_count()),
        25296+pt*4+std::min(3,b.pos.attackers_to(side,to_sq(m)).pop_count())};
}
class MovePolicy {
    std::array<int,policy_dim> weights{};
public:
    explicit MovePolicy(const std::string& path) {
        if(path.empty())return;
        std::ifstream in(path);std::string header;
        if(!std::getline(in,header)||header!="shogi-lab-quiet-policy-v1 dim25392 scale1024")
            throw std::invalid_argument("Invalid move policy header");
        for(auto& w:weights)if(!(in>>w)||std::abs(int64_t(w))>100000)
            throw std::invalid_argument("Invalid move policy weight");
        std::string extra;if(in>>extra)throw std::invalid_argument("Trailing move policy data");
    }
    int score(const Board& b,Move m) const {
        int v=0;for(int id:policy_features(b,m))v+=weights[id];return v;
    }
};
}
