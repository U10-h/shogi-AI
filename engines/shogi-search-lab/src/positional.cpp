#include "positional.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace lab {
const std::array<const char*,positional_size>& positional_names(){
    static const std::array<const char*,positional_size> names={
        "king_advance_squared","king_centrality","gold_adjacent","gold_near",
        "silver_adjacent","silver_near","pawn_shield","enemy_ring_attacks","own_ring_defenses",
        "rook_near_own_king","bishop_near_own_king","gold_advance","silver_advance",
        "knight_advance","lance_advance","pawn_advance","rook_advance","bishop_advance",
        "gold_centrality","silver_centrality","knight_centrality","central_pawn_advance",
        "rook_mobility","bishop_mobility","lance_mobility","knight_mobility","silver_mobility","gold_mobility",
        "promoted_king_proximity","attacker_king_proximity","hand_pawn","hand_lance","hand_knight",
        "hand_silver","hand_bishop","hand_rook","hand_gold","empty_king_ring_with_enemy_hand"};
    return names;
}
namespace {
int distance(Square a,Square b){return std::max(std::abs(int(file_of(a))-int(file_of(b))),std::abs(int(rank_of(a))-int(rank_of(b))));}
}
PositionalFeatures positional_features(const Board& b){
    PositionalFeatures x{};
    const auto occupied=b.pos.pieces();
    for(Color side:{BLACK,WHITE}){
        const int sign=side==BLACK?1:-1;
        const auto king=b.pos.king_square(side),enemy=b.pos.king_square(~side);
        const auto ring=kingEffect(king),enemy_ring=kingEffect(enemy);
        auto add=[&](int i,int v){x[i]+=sign*v;};
        const int ka=side==BLACK?8-int(rank_of(king)):int(rank_of(king));
        add(0,ka*ka);add(1,4-std::abs(int(file_of(king))-4));
        int enemy_hands=0;
        for(int p=1;p<=7;++p){
            add(29+p,hand_count(b.pos.hand_of(side),PieceType(p)));
            enemy_hands+=hand_count(b.pos.hand_of(~side),PieceType(p));
        }
        add(37,(ring&b.pos.empties()).pop_count()*std::min(enemy_hands,4));
        auto pieces=b.pos.pieces(side);
        while(pieces){
            const auto sq=pieces.pop();const auto pc=b.pos.piece_on(sq);const auto pt=type_of(pc);
            if(pt==KING)continue;
            const int advance=side==BLACK?8-int(rank_of(sq)):int(rank_of(sq));
            const int central=4-std::abs(int(file_of(sq))-4);
            const int own_d=distance(sq,king),enemy_d=distance(sq,enemy);
            const auto effects=effects_from(pc,sq,occupied);
            const int mobility=(effects&~b.pos.pieces(side)).pop_count();
            add(8,(effects&ring).pop_count());
            // The feature is charged to the attacked side, preserving antisymmetry.
            x[7]-=sign*(effects&enemy_ring).pop_count();
            if(pt==GOLD){add(2,own_d<=1);add(3,own_d<=2);add(11,advance);add(18,central);add(27,mobility);}
            if(pt==SILVER){add(4,own_d<=1);add(5,own_d<=2);add(12,advance);add(19,central);add(26,mobility);}
            if(pt==KNIGHT){add(13,advance);add(20,central);add(25,mobility);}
            if(pt==LANCE){add(14,advance);add(24,mobility);}
            if(pt==PAWN){
                add(15,advance);add(21,central*advance);
                int forward=side==BLACK?int(rank_of(king))-int(rank_of(sq)):int(rank_of(sq))-int(rank_of(king));
                add(6,forward==1&&std::abs(int(file_of(sq))-int(file_of(king)))<=1);
            }
            if(pt==ROOK||pt==DRAGON){add(9,8-own_d);add(16,advance);add(22,mobility);}
            if(pt==BISHOP||pt==HORSE){add(10,8-own_d);add(17,advance);add(23,mobility);}
            if(int(pt)>=9)add(28,8-enemy_d);
            if(pt!=PAWN&&pt!=GOLD)add(29,8-enemy_d);
        }
    }
    return x;
}
Evaluator::Evaluator(const std::string& mode,const std::string& model,const std::string& head):mode_(mode){
    if(mode=="nnue-blend25"||mode=="nnue-clipped") {
        nnue_=std::make_unique<Nnue>(model,"nnue");
        nnue_->residual_head(head,mode=="nnue-clipped");return;
    }
    if(!head.empty())throw std::invalid_argument("Evaluation head requires nnue-blend25 or nnue-clipped");
    if(mode=="nnue-tempo40"){nnue_=std::make_unique<Nnue>(model,"nnue");return;}
    if(mode=="nnue-cache"||mode=="nnue-fused"||mode=="nnue-fast"||mode=="nnue-fast-verify"||mode=="nnue"||mode=="nnue-full"||mode=="nnue-verify"||mode=="nnue-scalar"){
        nnue_=std::make_unique<Nnue>(model,mode);return;
    }
    if(mode!="material"&&mode!="positional"&&mode!="learned")throw std::invalid_argument("Eval must be material|positional|learned|nnue|nnue-full|nnue-verify");
    if(mode!="learned"&&!model.empty())throw std::invalid_argument("--eval-model requires --eval learned or nnue");
    // An explicit manual control, frozen before collecting any new labels.
    weights_={-5,-8,45,15,25,8,20,-18,7,-5,0,-2,3,2,-8,2,2,1,0,2,1,1,4,4,1,3,2,1,6,1,10,0,0,5,0,0,5,-5};
    if(mode=="learned"){
        std::ifstream in(model);std::string header;
        if(!std::getline(in,header)||header!="shogi-lab-positional-v1 38")throw std::invalid_argument("Invalid evaluation model header");
        for(size_t i=0;i<weights_.size();++i){
            std::string name;double v;
            if(!(in>>name>>v)||name!=positional_names()[i]||!std::isfinite(v)||std::abs(v)>500)throw std::invalid_argument("Invalid evaluation weight");
            weights_[i]=v;
        }
        std::string extra;if(in>>extra)throw std::invalid_argument("Unexpected evaluation model data");
    }
}
int Evaluator::operator()(const Board& b) const{
    if(nnue_)return std::clamp((*nnue_)(b)+(mode_=="nnue-tempo40"?36:0),-27000,27000);
    const int material=evaluate(b);if(mode_=="material")return material;
    const auto x=positional_features(b);double positional=0;
    for(size_t i=0;i<x.size();++i)positional+=x[i]*weights_[i];
    const int correction=int(std::lround(std::clamp(positional,-1500.0,1500.0)));
    return std::clamp(material+(b.pos.side_to_move()==BLACK?correction:-correction),-80000,80000);
}
std::array<uint8_t,32> Evaluator::nnue_features(const Board& b) const {
    if(!nnue_)throw std::invalid_argument("NNUE feature export requires an NNUE evaluator");
    return nnue_->first_hidden(b);
}
}
