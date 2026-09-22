#include "advanced.hpp"
#include "positional.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <tuple>
#include <unordered_map>

namespace lab {
std::set<std::string> advanced_features() {
    return {"tt","history","killer","counter","iid","etc","mate-distance",
        "qsearch","see-order","see-prune","delta","futility","reverse-futility",
        "razoring","null","adaptive-null","verified-null","lmr","check-extension",
        "recapture-extension","singular","multicut","probcut","multiprobcut"};
}
void set_advanced_features(AdvancedOptions& o, const std::string& csv) {
    o.features.clear(); std::istringstream in(csv); std::string f;
    while (std::getline(in,f,',')) {
        if (!advanced_features().count(f)) throw std::invalid_argument("Unknown feature: " + f);
        o.features.insert(f);
    }
}
void set_advanced_preset(AdvancedOptions& o, const std::string& p) {
    if (p == "baseline") {o.features.clear(); o.driver="ab";}
    else if (p == "exact") {set_advanced_features(o,"tt,history,killer,counter,mate-distance"); o.driver="pvs";}
    else if (p == "tactical") {set_advanced_preset(o,"exact"); o.features.insert("qsearch");}
    else if (p == "selective") {
        set_advanced_preset(o,"tactical");
        for (const char* f : {"lmr","verified-null","futility","check-extension"}) o.features.insert(f);
    } else throw std::invalid_argument("Preset must be baseline|exact|tactical|selective");
}
namespace {
struct Stop {const char* reason;};
struct Value {int score; std::vector<Move> pv;};
struct Key {
    uint64_t path; int depth, extensions;
    bool operator==(const Key& k) const {return path==k.path&&depth==k.depth&&extensions==k.extensions;}
};
struct KeyHash {size_t operator()(const Key& k) const {return std::hash<uint64_t>{}(k.path*257+uint64_t(k.depth*9+k.extensions));}};
struct PathHash {size_t operator()(const std::pair<uint64_t,int>& p) const {return std::hash<uint64_t>{}(p.first*65537+uint64_t(p.second));}};
struct Entry {int score, flag; Move move; std::vector<Move> pv;};
struct ProbModel {int deep, shallow; double slope, intercept, sigma, z;};
constexpr int max_ply=96;
int pack(Move m) {return int(m)&65535;}
std::string line_json(const std::vector<Move>& pv) {
    std::string s="["; for (Move m:pv) {if(s.size()>1)s+=','; s+=quote(usi(m));} return s+"]";
}
int local_score(int s,int ply) {return s>90000?s+ply:s< -90000?s-ply:s;}
int root_score(int s,int ply) {return s>90000?s-ply:s< -90000?s+ply:s;}
class Worker {
    Board& b; const AdvancedOptions& o;
    Evaluator eval;
    struct Flags {
        bool tt = false;
        bool history = false;
        bool killer = false;
        bool counter = false;
        bool iid = false;
        bool etc = false;
        bool mate_distance = false;
        bool qsearch = false;
        bool see_order = false;
        bool see_prune = false;
        bool delta = false;
        bool futility = false;
        bool reverse_futility = false;
        bool razoring = false;
        bool null = false;
        bool adaptive_null = false;
        bool verified_null = false;
        bool lmr = false;
        bool check_extension = false;
        bool recapture_extension = false;
        bool singular = false;
        bool multicut = false;
        bool probcut = false;
        bool multiprobcut = false;
    } f;
    double start;
    std::unordered_map<Key,Entry,KeyHash> tt;
    // Hashes guide ordering only. Value-cache identities are collision-free path IDs.
    std::unordered_map<uint64_t,Move> hash_moves;
    std::unordered_map<std::pair<uint64_t,int>,uint64_t,PathHash> paths;
    uint64_t next_path=1;
    std::array<std::array<int,65536>,2> history{};
    std::array<std::array<Move,2>,max_ply> killers{};
    std::array<std::array<Move,65536>,2> counters{};
    int null_level=0, isolated=0;
    Value partial_root{-infinity,{}};
    std::vector<ProbModel> models;
    std::ofstream trace;
    std::ofstream leaf_trace;
    static constexpr int prune_dim=17;
    std::ofstream prune_log;
    std::array<double,prune_dim> prune_weights{},prune_low{},prune_high{};
    double prune_threshold=0,prune_logit=-1e100;
    bool learned=false,prune_enabled=false;
    uint64_t prune_events=0;
    uint64_t leaf_events=0;
    int iteration_depth=0;
    Move current_root_move=MOVE_NONE;
    uint64_t events=0;
    bool on(const std::string& f) const {return o.features.count(f)!=0;}
    double now() const {
        if(o.limits.clock_ms)return o.limits.clock_ms();
        return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
    }
    void check() const {
        if(o.limits.stop_requested&&o.limits.stop_requested())throw Stop{"external_stop"};
        if(r.base.nodes>=o.limits.max_nodes)throw Stop{"node_limit"};
        if(o.limits.time_ms&&now()-start>=o.limits.time_ms)throw Stop{"time_limit"};
    }
    void tick() {check(); ++r.base.nodes;}
    void event(const char* method,int d,int ply,int a,int beta,int score,bool heuristic) {
        if(!trace.is_open())return;
        if(events++>=o.limits.trace_limit){++r.stats["trace_omitted"];return;}
        trace<<"{\"event\":"<<quote(method)<<",\"depth\":"<<d<<",\"ply\":"<<ply
             <<",\"alpha\":"<<a<<",\"beta\":"<<beta<<",\"score\":"<<score
             <<",\"heuristic\":"<<(heuristic?"true":"false")<<",\"sfen\":"<<quote(b.pos.sfen())<<"}\n";
    }
    uint64_t child_path(uint64_t parent,Move m) {
        if(!parent||!f.tt||isolated||null_level)return 0;
        auto key=std::make_pair(parent,pack(m));
        auto it=paths.find(key); if(it!=paths.end())return it->second;
        if(paths.size()>=o.tt_capacity*4){++r.stats["path_capacity_misses"];return 0;}
        return paths.emplace(key,++next_path).first->second;
    }
    bool cacheable(uint64_t path) const {return f.tt&&path&&!isolated&&!null_level;}
    bool tactical(Move m) const {return is_promote(m)||b.pos.piece_on(to_sq(m))!=NO_PIECE;}
    int gain(Move m) const {
        Piece p=b.pos.piece_on(to_sq(m));
        int v=p==NO_PIECE?0:piece_value(type_of(p))+piece_value(raw_type_of(p));
        if(is_promote(m)) {
            auto pt=type_of(b.pos.piece_on(from_sq(m)));
            v+=piece_value(PieceType(int(pt)+8))-piece_value(pt);
        }
        return v;
    }
    std::array<double,prune_dim> prune_features(Move m,Move incoming,int a,int stand,int left,int index,int count) const {
        const auto side=b.pos.side_to_move();
        const int captured=type_of(b.pos.piece_on(to_sq(m))),attacker=type_of(b.pos.piece_on(from_sq(m)));
        const int target=int(to_sq(m)),king=int(b.pos.king_square(~side));
        const int distance=std::max(std::abs(target/9-king/9),std::abs(target%9-king%9));
        double own=0,enemy=0;
        for(int p=1;p<=7;++p){own+=hand_count(b.pos.hand_of(side),PieceType(p))*piece_value(PieceType(p))*.9;enemy+=hand_count(b.pos.hand_of(~side),PieceType(p))*piece_value(PieceType(p))*.9;}
        double margin=(a-stand-gain(m)*.9)/900.0;
        return {1.,std::clamp((a-stand)/900.,-8.,8.),std::clamp(margin,-8.,8.),gain(m)*.9/1800.,
          piece_value(PieceType(attacker))*.9/900.,left/6.,std::min(index,16)/16.,std::min(count,16)/16.,
          incoming!=MOVE_NONE&&to_sq(incoming)==to_sq(m)?1.:0.,distance<=2?1.:0.,
          std::min(enemy/3600.,4.),std::min(own/3600.,4.),std::min(std::abs(stand)/3600.,4.),
          std::clamp(margin,0.,8.),raw_type_of(Piece(captured))==BISHOP||raw_type_of(Piece(captured))==ROOK?1.:0.,
          attacker==KING?1.:0.,captured==PAWN?1.:0.};
    }
    void prune_row(const char* event,const std::string& sfen,Move m,int a,int stand,int left,int index,
                   const std::array<double,prune_dim>& x,int score,uint64_t cost,bool guarded) {
        if(!prune_log.is_open())return;
        if(prune_events++>=o.limits.trace_limit){++r.stats["prune_log_omitted"];return;}
        prune_log<<"{\"event\":"<<quote(event)<<",\"sfen\":"<<quote(sfen)<<",\"move\":"<<quote(usi(m))
          <<",\"alpha\":"<<a<<",\"stand\":"<<stand<<",\"qleft\":"<<left<<",\"index\":"<<index
          <<",\"parent_score_bound\":"<<score<<",\"improves\":"<<(score>a?1:0)<<",\"cost\":"<<cost
          <<",\"guarded\":"<<(guarded?"true":"false")<<",\"x\":[";
        for(int i=0;i<prune_dim;++i){if(i)prune_log<<',';prune_log<<std::setprecision(12)<<x[i];}
        prune_log<<"]}\n";
    }
    // A bounded, legal same-square exchange search; not an exact shogi oracle.
    // Includes hand gains, demotion, optional promotion and pinned/king legality.
    int exchange(Square target,int remaining) {
        tick(); ++r.stats["see_nodes"];
        if(!remaining)return 0;
        int best=0;
        for(Move m:b.legal_moves())if(!is_drop(m)&&to_sq(m)==target) {
            int g=gain(m); {PlayedMove move(b,m); g-=exchange(target,remaining-1);}
            best=std::max(best,g);
        }
        return best;
    }
    int see(Move m) {
        ++r.stats["see_calls"]; int v=gain(m);
        {PlayedMove move(b,m);v-=exchange(to_sq(m),4);}
        return v;
    }
    std::vector<Move> order(std::vector<Move> moves,int ply,Move preferred,Move previous) {
        struct Item {Move move; int64_t priority; uint64_t key; std::string text;};
        std::vector<Item> items; auto side=b.pos.side_to_move();
        items.reserve(moves.size());
        r.stats[o.compact_ordering?"integer_order_keys":"string_order_keys"]+=moves.size();
        for(Move m:moves) {
            check();
            int64_t score=ordering_score(b,m);
            if(tactical(m))score+=10000000;
            if(f.see_order&&tactical(m))score+=int64_t(see(m))*10000;
            if(f.history&&!tactical(m))score+=history[side][pack(m)];
            if(f.killer&&ply<max_ply&&!tactical(m)) {
                if(m==killers[ply][0])score+=3000000;
                else if(m==killers[ply][1])score+=2000000;
            }
            if(f.counter&&previous!=MOVE_NONE&&m==counters[side][pack(previous)]&&!tactical(m))score+=1500000;
            if(m==preferred)score+=1000000000;
            items.push_back({m,score,o.compact_ordering?usi_sort_key(m):0,o.compact_ordering?std::string():usi(m)});
        }
        std::sort(items.begin(),items.end(),[&](const Item&a,const Item&b){return a.priority!=b.priority?a.priority>b.priority:o.compact_ordering?a.key<b.key:a.text<b.text;});
        moves.clear();for(auto& i:items)moves.push_back(i.move);return moves;
    }
    void leaf_event(const char* phase,uint64_t node,uint64_t parent,Move incoming,
                    int ply,int left,int a,int beta,const char* reason,
                    bool has_score,int score,const std::vector<Move>& pv={}) {
        if(!leaf_trace.is_open())return;
        if(leaf_events++>=o.limits.trace_limit){++r.stats["leaf_trace_omitted"];return;}
        leaf_trace<<"{\"event\":"<<quote(phase)<<",\"node\":"<<node<<",\"parent_qnode\":"<<parent
          <<",\"iteration_depth\":"<<iteration_depth<<",\"root_move\":"<<(current_root_move==MOVE_NONE?"null":quote(usi(current_root_move)))
          <<",\"incoming\":"<<(incoming==MOVE_NONE?"null":quote(usi(incoming)))
          <<",\"ply\":"<<ply<<",\"qleft\":"<<left<<",\"alpha\":"<<a<<",\"beta\":"<<beta
          <<",\"checked\":"<<(b.pos.in_check()?"true":"false")<<",\"null_level\":"<<null_level
          <<",\"isolated\":"<<isolated<<",\"reason\":"<<quote(reason)<<",\"score\":"<<(has_score?std::to_string(score):"null")
          <<",\"pv\":"<<line_json(pv)<<",\"sfen\":"<<quote(b.pos.sfen())<<"}\n";
    }
    Value qsearch(int a,int beta,int ply,int left,uint64_t parent=0,Move incoming=MOVE_NONE) {
        tick();++r.stats["qnodes"];
        const uint64_t node=r.base.nodes;
        const int original_a=a;
        auto finish=[&](Value v,const char* reason) {
            leaf_event("qreturn",node,parent,incoming,ply,left,original_a,beta,reason,true,v.score,v.pv);return v;
        };
        if(!null_level)if(auto rep=b.repetition_score(ply))return finish({*rep,{}},"repetition");
        const bool checked=b.pos.in_check();
        // A legal king move certifies non-terminal status without materializing
        // the move list. If the witness fails, keep the exact eager fallback.
        const bool deferred=o.defer_qmoves&&o.direct_qmoves&&!checked&&b.has_legal_king_move();
        std::vector<Move> moves;
        auto generate=[&]() {
            moves=o.direct_qmoves&&!checked?b.tactical_moves():b.legal_moves();
            ++r.stats[o.direct_qmoves&&!checked?"q_tactical_generations":"q_full_generations"];
            r.stats["q_generated_moves"]+=moves.size();
        };
        if(deferred)++r.stats["q_deferred_nodes"];
        else {
            generate();
            if(moves.empty()&&(!o.direct_qmoves||checked||!b.has_legal_move())){++r.base.terminals;return finish({-mate+ply,{}},"terminal");}
        }
        if(ply>=max_ply-1)throw Stop{"ply_limit"}; // Never publish static evaluation in unresolved check.
        const int stand=(!checked||o.eager_evaluation)?eval(b):0; Value best{checked?-infinity:stand,{}};
        leaf_event("qeval",node,parent,incoming,ply,left,a,beta,checked?"check_evasion":"stand_pat",!checked,stand);
        if(!checked) {
            if(left<=0){++r.base.leaves;if(deferred)++r.stats["q_avoided_generations"];return finish(best,"qdepth_limit");}
            if(stand>=beta){++r.stats["qstand_cutoffs"];if(deferred)++r.stats["q_avoided_generations"];return finish(best,"stand_pat_cutoff");}
            a=std::max(a,stand);
            if(deferred)generate();
            moves.erase(std::remove_if(moves.begin(),moves.end(),[&](Move m){return !tactical(m);}),moves.end());
        }
        moves=order(std::move(moves),ply,MOVE_NONE,MOVE_NONE);
        int move_index=0;bool learned_cut=false;
        for(Move m:moves) {
            const int index=move_index++;
            const bool checkmove=b.pos.gives_check(m);
            if(!checked&&!checkmove&&!isolated) {
                if(f.delta&&stand+gain(m)+200<a){++r.stats["delta_prunes"];continue;}
                if(f.see_prune&&see(m)<0){++r.stats["see_prunes"];continue;}
            }
            const bool eligible=prune_enabled&&!checked&&!checkmove&&!isolated&&!null_level&&
              !is_drop(m)&&!is_promote(m)&&b.pos.piece_on(to_sq(m))!=NO_PIECE&&
              beta-a==1&&std::abs(a)<8000&&std::abs(stand)<8000;
            std::array<double,prune_dim> x{};bool guarded=false;
            std::string parent_sfen;
            if(eligible){
                ++r.stats["learned_eligible"];
                x=prune_features(m,incoming,a,stand,left,index,int(moves.size()));
                guarded=index>=2&&left>=3&&x[8]==0&&x[9]==0&&x[15]==0&&x[2]>=0&&!learned_cut;
                if(prune_log.is_open())parent_sfen=b.pos.sfen();
                if(guarded)++r.stats["learned_guard_eligible"];
                double logit=0;bool in_domain=true;
                for(int j=0;j<prune_dim;++j){logit+=x[j]*prune_weights[j];if(x[j]<prune_low[j]-1e-9||x[j]>prune_high[j]+1e-9)in_domain=false;}
                bool skip=learned&&prune_threshold>0&&logit<=prune_logit;
                if(o.prune_policy!="direct")skip=skip&&guarded&&in_domain;
                if(skip&&o.prune_policy=="verified") {
                    ++r.stats["learned_verifications"];const uint64_t before=r.base.nodes;
                    // A shallow bound is evidence only, not a proof at the original q depth.
                    const int threshold=a-90;Value shallow;
                    {struct Guard{int& n;Guard(int& x):n(x){++n;}~Guard(){--n;}} guard(isolated);
                     PlayedMove move(b,m);shallow=qsearch(-threshold-1,-threshold,ply+1,0,node,m);}
                    r.stats["learned_verification_nodes"]+=r.base.nodes-before;
                    skip=-shallow.score<=threshold;
                    if(!skip)++r.stats["learned_verification_rejects"];
                }
                if(skip){
                    if(o.prune_audit){
                        const uint64_t before=r.base.nodes;Value reference;
                        {struct Guard{int& n;Guard(int& x):n(x){++n;}~Guard(){--n;}} guard(isolated);
                         PlayedMove move(b,m);reference=qsearch(-beta,-a,ply+1,left-1,node,m);}
                        ++r.stats["learned_audits"];r.stats["learned_audit_nodes"]+=r.base.nodes-before;
                        if(-reference.score>a)++r.stats["learned_false_prunes"];
                        prune_row("audit",parent_sfen,m,a,stand,left,index,x,-reference.score,r.base.nodes-before,guarded);
                    }
                    ++r.stats["learned_prunes"];learned_cut=true;continue;
                }
            }
            const uint64_t before=r.base.nodes;
            Value c;{PlayedMove move(b,m);c=qsearch(-beta,-a,ply+1,left-1,node,m);}
            if(eligible)prune_row("observed",parent_sfen,m,a,stand,left,index,x,-c.score,r.base.nodes-before,guarded);
            if(-c.score>best.score){best={-c.score,{m}};best.pv.insert(best.pv.end(),c.pv.begin(),c.pv.end());}
            a=std::max(a,best.score);if(a>=beta){++r.base.cutoffs;return finish(best,"child_beta_cutoff");}
        }
        return finish(best,best.pv.empty()?"stand_pat_selected":"child_selected");
    }
    // Probes use the same leaf policy, but no selective pruning, extensions,
    // bound-table access or writes. This prevents speculative cache poisoning.
    Value probe(int d,int a,int beta,int ply,Move prev) {
        struct Guard {int& n;Guard(int& x):n(x){++n;}~Guard(){--n;}} guard(isolated);
        return visit(d,a,beta,ply,0,0,false,prev);
    }
    Value visit(int d,int a,int beta,int ply,uint64_t path,int ext,bool allow_null,Move prev) {
        if(d<=0&&f.qsearch)return qsearch(a,beta,ply,o.qdepth,0,prev);
        tick();
        if(ply>=max_ply-1)throw Stop{"ply_limit"};
        if(!null_level)if(auto rep=b.repetition_score(ply)){++r.base.terminals;return {*rep,{}};}
        auto moves=b.legal_moves();
        if(moves.empty()){++r.base.terminals;return {-mate+ply,{}};}
        if(d<=0){++r.base.leaves;return {eval(b),{}};}
        const int original_a=a,original_beta=beta;
        const bool checked=b.pos.in_check(),pvnode=beta-a>1;
        Key key{path,d,ext};
        Move preferred=MOVE_NONE;
        if(f.tt) {
            auto hint=hash_moves.find(uint64_t(b.pos.key()));if(hint!=hash_moves.end())preferred=hint->second;
            if(cacheable(path)) {
                ++r.stats["tt_probes"];auto it=tt.find(key);
                if(it!=tt.end()) {
                    ++r.stats["tt_hits"];const auto& e=it->second;int s=root_score(e.score,ply);preferred=e.move;
                    if(e.flag==0||(e.flag>0&&s>=beta)||(e.flag<0&&s<=a)) {
                        ++r.stats["tt_cutoffs"];return {s,e.pv};
                    }
                }
            }
        }
        auto finish=[&](Value v) {
            if(f.tt&&!isolated&&!null_level&&!v.pv.empty()) {
                if(hash_moves.size()<o.tt_capacity||hash_moves.count(uint64_t(b.pos.key())))hash_moves[uint64_t(b.pos.key())]=v.pv.front();
            }
            if(cacheable(path)) {
                int flag=v.score<=original_a?-1:v.score>=original_beta?1:0;
                if(tt.size()<o.tt_capacity||tt.count(key))tt[key]={local_score(v.score,ply),flag,v.pv.empty()?MOVE_NONE:v.pv[0],v.pv};
                else ++r.stats["tt_capacity_misses"];
            }
            return v;
        };
        if(f.mate_distance&&ply>0) {
            a=std::max(a,-mate+ply);beta=std::min(beta,mate-ply-1);
            if(a>=beta){++r.stats["mate_distance_cutoffs"];return {a,{}};}
        }
        const bool eligible=!isolated&&!pvnode&&!checked&&ply>0&&std::abs(a)<90000&&std::abs(beta)<90000;
        const bool needs_static=eligible&&(f.reverse_futility||f.razoring||f.null||f.adaptive_null||f.verified_null||f.futility);
        const int stand=(needs_static||o.eager_evaluation)?eval(b):0;
        if(eligible&&f.reverse_futility&&d<=2&&stand-300*d>=beta) {
            ++r.stats["reverse_futility_prunes"];event("reverse_futility",d,ply,a,beta,stand,true);return finish({stand,{}});
        }
        if(eligible&&f.razoring&&f.qsearch&&d<=2&&stand+400*d<a) {
            ++r.stats["razor_probes"];auto q=qsearch(a,beta,ply,o.qdepth);
            if(q.score<=a){++r.stats["razor_prunes"];return finish(q);}
        }
        if(eligible&&allow_null&&d>=3&&(f.null||f.adaptive_null||f.verified_null)) {
            // Bare kings / pawn-only positions and positions with enemy hand threats
            // are deliberately excluded. The remaining rule is still heuristic.
            bool nonpawn=false;
            for(int sq=0;sq<81;++sq){Piece p=b.pos.piece_on(Square(sq));if(p!=NO_PIECE&&color_of(p)==b.pos.side_to_move()&&type_of(p)!=KING&&raw_type_of(p)!=PAWN)nonpawn=true;}
            if(nonpawn&&b.pos.hand_of(~b.pos.side_to_move())==HAND_ZERO&&stand>=beta) {
                ++r.stats["null_probes"];int reduction=(f.adaptive_null||f.verified_null)&&d>=6?3:2;
                Value v;
                {
                    struct NullGuard {Board& b;StateInfo st;int& level;NullGuard(Board& bb,int& n):b(bb),level(n){b.pos.do_null_move(st);b.remember();++level;}~NullGuard(){--level;b.history.pop_back();b.pos.undo_null_move();}} guard(b,null_level);
                    v=visit(d-1-reduction,-beta,-beta+1,ply+1,0,ext,false,MOVE_NONE);
                }
                if(-v.score>=beta) {
                    bool accept=true;
                    if(f.verified_null) {
                        ++r.stats["null_verifications"];
                        // Full target-depth confirmation: stricter and more costly
                        // than the reduced-depth continuation of David/Netanyahu.
                        auto verified=probe(d,beta-1,beta,ply,prev);
                        accept=verified.score>=beta;
                        if(!accept)++r.stats["null_rejected"];
                    }
                    if(accept){++r.stats["null_prunes"];event("null",d,ply,a,beta,beta,true);return finish({beta,{}});}
                }
            }
        }
        if(eligible&&(f.probcut||f.multiprobcut)) {
            for(const auto& m:models)if(m.deep==d) {
                const double t=(beta-m.intercept+m.z*m.sigma)/m.slope;
                if(t>90000||t< -90000)continue;
                int bound=int(std::ceil(t));++r.stats["probcut_probes"];
                auto v=probe(m.shallow,bound-1,bound,ply,prev);
                if(v.score>=bound){++r.stats["probcut_prunes"];event("probcut",d,ply,a,beta,beta,true);return finish({beta,{}});}
                if(!f.multiprobcut)break;
            }
        }
        if(f.iid&&!isolated&&preferred==MOVE_NONE&&d>=3) {
            ++r.stats["iid_probes"];auto v=probe(d-2,a,beta,ply,prev);if(!v.pv.empty())preferred=v.pv[0];
        }
        moves=order(std::move(moves),ply,preferred,prev);
        if(f.etc&&cacheable(path)&&d>=2) {
            for(Move m:moves) {
                check();++r.stats["etc_probes"];auto id=child_path(path,m);
                auto found=tt.find({id,d-1,ext});
                if(found!=tt.end()&&found->second.flag<=0) {
                    int s=-root_score(found->second.score,ply+1);
                    if(s>=beta){++r.stats["etc_cutoffs"];Value v{s,{m}};v.pv.insert(v.pv.end(),found->second.pv.begin(),found->second.pv.end());return finish(v);}
                }
            }
        }
        if(eligible&&f.multicut&&d>=3) {
            int cuts=0;for(size_t i=0;i<std::min<size_t>(6,moves.size());++i){Move m=moves[i];Value v;++r.stats["multicut_probes"];{PlayedMove move(b,m);v=probe(d-3,-beta,-beta+1,ply+1,m);}if(-v.score>=beta)++cuts;if(cuts>=3){++r.stats["multicut_prunes"];event("multicut",d,ply,a,beta,beta,true);return finish({beta,{}});}}
        }
        Move singular=MOVE_NONE;
        if(f.singular&&!isolated&&d>=4&&ext>0&&preferred!=MOVE_NONE&&moves.front()==preferred) {
            ++r.stats["singular_probes"];int candidate;
            {PlayedMove move(b,preferred);candidate=-probe(d-3,-infinity,infinity,ply+1,preferred).score;}
            int threshold=candidate-150;bool unique=std::abs(candidate)<90000;
            for(Move m:moves)if(m!=preferred&&unique){PlayedMove move(b,m);if(-probe(d-3,-threshold,-threshold+1,ply+1,m).score>=threshold)unique=false;}
            if(unique){singular=preferred;++r.stats["singular_confirmed"];}
        }
        Value best{-infinity,{}};size_t index=0;std::vector<Move> quiet_searched;
        const Color side=b.pos.side_to_move();
        for(Move m:moves) {
            const bool noise=tactical(m),gives=b.pos.gives_check(m);
            // Never prune first move, captures, promotions, checks, drops, evasions.
            if(eligible&&index>0&&!noise&&!gives&&!is_drop(m)&&f.futility&&d<=2&&stand+300*d<=a) {
                ++r.stats["futility_prunes"];++index;continue;
            }
            int extension=0;
            if(!isolated&&ext>0) {
                if(f.check_extension&&checked){extension=1;++r.stats["check_extensions"];}
                else if(f.recapture_extension&&prev!=MOVE_NONE&&noise&&to_sq(m)==to_sq(prev)){extension=1;++r.stats["recapture_extensions"];}
                else if(m==singular){extension=1;++r.stats["singular_extensions"];}
            }
            int nd=d-1+extension;
            bool reduce=!isolated&&f.lmr&&d>=3&&index>=4&&!checked&&!noise&&!gives&&!is_drop(m)&&extension==0;
            Value c;auto id=child_path(path,m);
            if(ply==0)current_root_move=m;
            {
                PlayedMove move(b,m);
                if(reduce) {
                    ++r.stats["lmr_reductions"];
                    int red=(d>=6&&index>=12)?2:1;
                    c=visit(std::max(0,nd-red),-a-1,-a,ply+1,id,ext-extension,true,m);
                    if(-c.score>a){++r.stats["lmr_researches"];c=visit(nd,-beta,-a,ply+1,id,ext-extension,true,m);}
                } else if(o.driver!="ab"&&index>0&&beta-a>1) {
                    ++r.stats["pvs_probes"];c=visit(nd,-a-1,-a,ply+1,id,ext-extension,true,m);
                    if(-c.score>a&&-c.score<beta){++r.stats["pvs_researches"];c=visit(nd,-beta,-a,ply+1,id,ext-extension,true,m);}
                } else c=visit(nd,-beta,-a,ply+1,id,ext-extension,true,m);
            }
            if(-c.score>best.score){best={-c.score,{m}};best.pv.insert(best.pv.end(),c.pv.begin(),c.pv.end());}
            if(ply==0&&!isolated&&!r.base.has_result&&original_a==-infinity&&original_beta==infinity) {
                ++r.completed_root_moves;
                partial_root=best;
            }
            a=std::max(a,best.score);
            if(!noise)quiet_searched.push_back(m);
            if(a>=beta) {
                ++r.base.cutoffs;r.base.skipped_siblings+=moves.size()-index-1;
                if(!noise&&!isolated) {
                    if(f.killer){if(killers[ply][0]!=m){killers[ply][1]=killers[ply][0];killers[ply][0]=m;}++r.stats["killer_updates"];}
                    if(f.history) {
                        int bonus=std::min(2000,d*d*32);auto update=[&](Move h,int delta){auto& v=history[side][pack(h)];v+=delta-v*std::abs(delta)/16384;};
                        update(m,bonus);for(Move h:quiet_searched)if(h!=m)update(h,-bonus/2);++r.stats["history_updates"];
                    }
                    if(f.counter&&prev!=MOVE_NONE){counters[side][pack(prev)]=m;++r.stats["counter_updates"];}
                }
                break;
            }
            ++index;
        }
        return finish(best);
    }
    Value rps(int budget,int a,int beta,int ply,Move prev) {
        if(budget<=0&&f.qsearch)return qsearch(a,beta,ply,o.qdepth,0,prev);
        tick();++r.stats["rps_nodes"];
        if(ply>=max_ply-1)throw Stop{"ply_limit"};
        if(auto rep=b.repetition_score(ply))return {*rep,{}};
        auto moves=b.legal_moves();if(moves.empty())return {-mate+ply,{}};
        if(budget<=0){++r.base.leaves;return {eval(b),{}};}
        moves=order(std::move(moves),ply,MOVE_NONE,prev);
        Value best{-infinity,{}};size_t index=0;
        for(Move m:moves) {
            // Compact category model adapted from Tsuruoka et al. Table 1.
            // It is not a re-trained professional-game probability model.
            double p=.05;
            bool capture=b.pos.piece_on(to_sq(m))!=NO_PIECE;
            int exchange_gain=tactical(m)?see(m):0;
            if(!is_drop(m)&&raw_type_of(b.pos.piece_on(from_sq(m)))==PAWN)p=.23;
            if(capture)p=std::max(p,exchange_gain>0?.42:exchange_gain==0?.09:.02);
            if(capture&&prev!=MOVE_NONE&&to_sq(m)==to_sq(prev))p=std::max(p,exchange_gain>0?.89:exchange_gain==0?.22:.05);
            if(is_promote(m))p=std::max(p,exchange_gain>=0?.22:.02);
            if(b.pos.gives_check(m))p=std::max(p,exchange_gain>0?.43:exchange_gain==0?.25:.04);
            int cost=moves.size()==1?0:int(std::lround(-std::log2(p)*1000));
            if(o.driver=="erps"&&index<5&&cost>1000){cost=1000;++r.stats["erps_early_caps"];}
            Value c;
            if(ply==0)current_root_move=m;
            {PlayedMove move(b,m);
                if(cost>1000){++r.stats["rps_probes"];c=rps(budget-cost,-a-1,-a,ply+1,m);
                    if(-c.score>a&&o.driver=="erps"&&(cost+1000)/2>1500){++r.stats["erps_intermediate"];c=rps(budget-(cost+1000)/2,-a-1,-a,ply+1,m);}
                    if(-c.score>a){++r.stats["rps_researches"];c=rps(budget-1000,-beta,-a,ply+1,m);}
                }else c=rps(budget-cost,-beta,-a,ply+1,m);
            }
            if(-c.score>best.score){best={-c.score,{m}};best.pv.insert(best.pv.end(),c.pv.begin(),c.pv.end());}
            a=std::max(a,best.score);if(a>=beta){++r.base.cutoffs;break;}++index;
        }
        return best;
    }
    Value root(int d,int guess) {
        if(o.driver=="rps"||o.driver=="erps")return rps(1000*d,-infinity,infinity,0,MOVE_NONE);
        if(o.driver=="mtdf"||o.driver=="sss"||o.driver=="dual") {
            // True game-value limits, not the wider alpha-beta sentinels.
            // Starting DUAL at -infinity with mate-distance pruning would
            // advance a loose fail-hard bound one point per pass.
            int lower=-mate,upper=mate,g=o.driver=="sss"?mate:o.driver=="dual"?-mate:guess;
            while(lower<upper) {
                check();int beta=o.driver=="sss"?g:o.driver=="dual"?g+1:(g==lower?g+1:g);
                ++r.stats["mtd_passes"];g=visit(d,beta-1,beta,0,1,o.extension_budget,true,MOVE_NONE).score;
                if(g<beta)upper=g;else lower=g;
            }
            // Reconstruct an exact PV, not an arbitrary fail-low bound path.
            ++r.stats["mtd_pv_recovery"];
            return visit(d,g-1,g+1,0,1,o.extension_budget,true,MOVE_NONE);
        }
        if(o.driver=="aspiration"&&d>1) {
            int window=o.aspiration;
            for(;;) {
                int a=std::max(-infinity,guess-window),beta=std::min(infinity,guess+window);
                auto v=visit(d,a,beta,0,1,o.extension_budget,true,MOVE_NONE);
                if(v.score>a&&v.score<beta)return v;
                ++r.stats["aspiration_retries"];window=std::min(infinity*2,window*2);
            }
        }
        return visit(d,-infinity,infinity,0,1,o.extension_budget,true,MOVE_NONE);
    }
    std::vector<AdvancedLine> rank(int d) {
        tick();
        if(!null_level)if(auto rep=b.repetition_score(0))return {{*rep,{}}};
        auto moves=b.legal_moves();if(moves.empty())return {{-mate,{}}};
        moves=order(std::move(moves),0,MOVE_NONE,MOVE_NONE);
        std::vector<AdvancedLine> lines;
        for(Move m:moves) {
            Value c;auto path=child_path(1,m);bool reject=false;
            current_root_move=m;
            {PlayedMove move(b,m);
                if(int(lines.size())>=o.multipv) {
                    // Inclusive tie screening: equal values may improve USI tie order.
                    int threshold=lines.back().score;++r.stats["multipv_screens"];
                    c=visit(d-1,-threshold,-threshold+1,1,path,o.extension_budget,true,m);
                    reject=-c.score<threshold;
                }
                if(!reject)c=visit(d-1,-infinity,infinity,1,path,o.extension_budget,true,m);
            }
            if(reject){++r.stats["multipv_exclusions"];continue;}
            AdvancedLine line{-c.score,{m}};line.pv.insert(line.pv.end(),c.pv.begin(),c.pv.end());lines.push_back(std::move(line));
            std::sort(lines.begin(),lines.end(),[](const auto&a,const auto&b){return a.score!=b.score?a.score>b.score:usi(a.pv[0])<usi(b.pv[0]);});
            if(int(lines.size())>o.multipv)lines.pop_back();
            if(!r.base.has_result){++r.completed_root_moves;partial_root={lines.front().score,lines.front().pv};}
        }
        return lines;
    }
public:
    AdvancedResult r;
    Worker(Board& board,const AdvancedOptions& options):b(board),o(options),eval(o.evaluation,o.evaluation_model) {
        f.tt=o.features.count("tt")!=0;
        f.history=o.features.count("history")!=0;
        f.killer=o.features.count("killer")!=0;
        f.counter=o.features.count("counter")!=0;
        f.iid=o.features.count("iid")!=0;
        f.etc=o.features.count("etc")!=0;
        f.mate_distance=o.features.count("mate-distance")!=0;
        f.qsearch=o.features.count("qsearch")!=0;
        f.see_order=o.features.count("see-order")!=0;
        f.see_prune=o.features.count("see-prune")!=0;
        f.delta=o.features.count("delta")!=0;
        f.futility=o.features.count("futility")!=0;
        f.reverse_futility=o.features.count("reverse-futility")!=0;
        f.razoring=o.features.count("razoring")!=0;
        f.null=o.features.count("null")!=0;
        f.adaptive_null=o.features.count("adaptive-null")!=0;
        f.verified_null=o.features.count("verified-null")!=0;
        f.lmr=o.features.count("lmr")!=0;
        f.check_extension=o.features.count("check-extension")!=0;
        f.recapture_extension=o.features.count("recapture-extension")!=0;
        f.singular=o.features.count("singular")!=0;
        f.multicut=o.features.count("multicut")!=0;
        f.probcut=o.features.count("probcut")!=0;
        f.multiprobcut=o.features.count("multiprobcut")!=0;

        const auto known=advanced_features();for(auto& f:o.features)if(!known.count(f))throw std::invalid_argument("Unknown feature "+f);
        const std::set<std::string> drivers={"ab","pvs","aspiration","mtdf","sss","dual","rps","erps"};
        if(!drivers.count(o.driver))throw std::invalid_argument("Unknown driver");
        if(o.limits.depth<0||o.limits.depth>16||!o.limits.max_nodes||o.limits.time_ms>3600000||o.multipv<1||o.multipv>5||o.qdepth<0||o.qdepth>16||o.extension_budget<0||o.extension_budget>8||o.tt_capacity<1||o.tt_capacity>1000000||o.aspiration<1||o.aspiration>10000)throw std::invalid_argument("Invalid advanced limits");
        const std::set<std::string> selective={"see-prune","delta","futility","reverse-futility","razoring","null","adaptive-null","verified-null","lmr","multicut","probcut","multiprobcut"};
        for(auto& f:selective)if(on(f))r.selective=true;
        const std::set<std::string> prune_policies={"off","collect","direct","guarded","verified"};
        if(!prune_policies.count(o.prune_policy))throw std::invalid_argument("Unknown learned prune policy");
        prune_enabled=o.prune_policy!="off";learned=prune_enabled&&o.prune_policy!="collect";
        if(!std::isfinite(o.prune_probability)||(o.prune_probability!=-1&&(o.prune_probability<0||o.prune_probability>=1)))throw std::invalid_argument("Prune probability must be -1 or [0,1)");
        if(prune_enabled){
            if(o.evaluation!="nnue"||!f.qsearch||o.qdepth!=6||r.selective||o.driver!="pvs")throw std::invalid_argument("Learned pruning requires nnue, PVS, qdepth 6 and nonselective features");
            if(learned){
                std::ifstream input(o.prune_model);std::string header;
                if(!std::getline(input,header)||header!="shogi-lab-alpha-risk-v1 nnue_raw90 qdepth6 dim17")throw std::invalid_argument("Invalid learned prune model header");
                if(!(input>>prune_threshold)||!std::isfinite(prune_threshold)||prune_threshold<0||prune_threshold>=1)throw std::invalid_argument("Invalid prune calibration");
                for(auto* row:{&prune_weights,&prune_low,&prune_high})for(double& v:*row)if(!(input>>v)||!std::isfinite(v))throw std::invalid_argument("Invalid prune coefficients");
                std::string excess;if(input>>excess)throw std::invalid_argument("Trailing prune coefficients");
                for(int i=0;i<prune_dim;++i)if(prune_low[i]>prune_high[i])throw std::invalid_argument("Invalid prune domain");
                if(o.prune_probability>=0)prune_threshold=o.prune_probability;
                prune_logit=prune_threshold>0?std::log(prune_threshold/(1-prune_threshold)):-1e100;
                r.selective=true;
            }
        }else if(o.prune_audit||!o.prune_log_path.empty()||!o.prune_model.empty()||o.prune_probability!=-1)throw std::invalid_argument("Prune options require an active policy");
        if(o.prune_audit&&!learned)throw std::invalid_argument("Audit requires a learned prune policy");
        if(o.driver=="rps"||o.driver=="erps"){
            r.selective=true;
            for(auto& f:o.features)if(f!="qsearch"&&f!="see-order")throw std::invalid_argument("RPS/ERPS use only qsearch and see-order features; pass --features explicitly");
        }
        r.leaf_policy=f.qsearch?"bounded_quiescence":"fixed_"+o.evaluation;
        if(o.driver=="rps"||o.driver=="erps")r.leaf_policy="probability_budget+"+r.leaf_policy;
        if(f.check_extension||f.recapture_extension||f.singular)r.leaf_policy+="+extensions";
        if((o.driver=="mtdf"||o.driver=="sss"||o.driver=="dual")&&(!f.tt||r.selective||r.leaf_policy.find("extensions")!=std::string::npos))throw std::invalid_argument("MTD drivers require tt and a nonselective fixed leaf policy");
        if((f.delta||f.see_prune||f.razoring)&&!f.qsearch)throw std::invalid_argument("delta/see-prune/razoring require qsearch");
        if(f.etc&&(!f.tt||r.leaf_policy.find("extensions")!=std::string::npos))throw std::invalid_argument("ETC requires tt and no extensions");
        if(o.multipv>1&&o.driver!="ab"&&o.driver!="pvs")throw std::invalid_argument("MultiPV supports ab or pvs driver");
        if(f.probcut||f.multiprobcut) {
            if(o.evaluation!="material")throw std::invalid_argument("ProbCut coefficients require material evaluation");
            if(o.probcut_model.empty())throw std::invalid_argument("ProbCut needs a calibrated model file");
            std::ifstream input(o.probcut_model);std::string header;
            if(!std::getline(input,header)||header!="shogi-lab-probcut-v1 fixed_material")throw std::invalid_argument("Invalid ProbCut model header");
            if(f.qsearch)throw std::invalid_argument("This ProbCut model is calibrated for fixed_material only");
            ProbModel m;while(input>>m.deep>>m.shallow>>m.slope>>m.intercept>>m.sigma>>m.z) {
                if(m.deep<2||m.deep>16||m.shallow<0||m.shallow>=m.deep||!std::isfinite(m.slope)||!std::isfinite(m.intercept)||!std::isfinite(m.sigma)||!std::isfinite(m.z)||m.slope<=0||m.sigma<=0||m.z<1)throw std::invalid_argument("Invalid ProbCut coefficients");
                models.push_back(m);
            }
            if(!input.eof()||models.empty())throw std::invalid_argument("Missing or malformed ProbCut rows");
        }
        if(!o.limits.trace_path.empty()){trace.open(o.limits.trace_path);if(!trace)throw std::runtime_error("Cannot open advanced trace");}
        if(!o.leaf_trace_path.empty()){leaf_trace.open(o.leaf_trace_path);if(!leaf_trace)throw std::runtime_error("Cannot open leaf trace");}
        if(!o.prune_log_path.empty()){prune_log.exceptions(std::ios::badbit|std::ios::failbit);prune_log.open(o.prune_log_path);}
    }
    AdvancedResult run() {
        start=now();
        int first=o.limits.iterative&&o.limits.depth>0?1:o.limits.depth;
        try {
            for(int d=first;d<=o.limits.depth;++d) {
                iteration_depth=d;current_root_move=MOVE_NONE;
                uint64_t before=r.base.nodes;double t=now();Value v;std::vector<AdvancedLine> lines;
                if(o.multipv>1&&d>0){lines=rank(d);v={lines.front().score,lines.front().pv};}
                else {v=root(d,r.base.has_result?r.base.score:eval(b));if(!v.pv.empty())lines.push_back({v.score,v.pv});}
                r.base.score=v.score;r.base.pv=v.pv;r.candidates=std::move(lines);
                r.base.has_result=true;r.base.completed_depth=d;
                r.base.iterations.push_back({d,v.score,r.base.nodes-before,0,now()-t,v.pv});
                if(d==o.limits.depth){r.base.complete=true;r.base.stop_reason="depth_limit";}
                if(d>0&&v.pv.empty()&&(b.repetition_score(0).has_value()||b.legal_moves().empty())){r.base.complete=true;r.base.stop_reason="terminal";break;}
            }
        }catch(const Stop& stop){r.base.stop_reason=stop.reason;}
        if(!r.base.has_result&&!b.repetition_score(0)) {
            if(!partial_root.pv.empty()) {
                r.fallback_pv=partial_root.pv;r.fallback_score=partial_root.score;
                r.fallback_source="completed_root_child";
            } else {
                auto legal=b.legal_moves();
                if(!legal.empty()){r.fallback_pv={legal.front()};r.fallback_source="first_legal";}
            }
        }
        for(const auto& item:eval.stats())r.stats[item.first]=item.second;
        r.base.elapsed_ms=now()-start;r.stats["tt_entries"]=tt.size();r.stats["history_paths"]=paths.size();
        if(prune_log.is_open())prune_log.flush();
        return r;
    }
};
}
AdvancedResult advanced_search(Board& b,const AdvancedOptions& o) {
    // Large heuristic arrays live on the heap, keeping recursion stack bounded.
    auto worker=std::make_unique<Worker>(b,o);return worker->run();
}
std::string advanced_json(const AdvancedResult& r,const AdvancedOptions& o) {
    std::string base=result_json(r.base,o.limits);base.pop_back();
    const auto first_comma=base.find(',');
    base="{\"algorithm\":\"advanced\""+base.substr(first_comma);
    std::ostringstream out;out<<base<<",\"engine\":\"research-v0.9\",\"evaluation\":"<<quote(o.evaluation)<<",\"score_unit\":"<<quote(o.evaluation.rfind("nnue",0)==0?"yaneuraou_raw_pawn90":"lab_pawn100")<<",\"evaluation_model\":"<<quote(o.evaluation_model)<<",\"eager_evaluation\":"<<(o.eager_evaluation?"true":"false")<<",\"compact_ordering\":"<<(o.compact_ordering?"true":"false")<<",\"direct_qmoves\":"<<(o.direct_qmoves?"true":"false")<<",\"driver\":"<<quote(o.driver)<<",\"selective\":"<<(r.selective?"true":"false")
        <<",\"defer_qmoves\":"<<(o.defer_qmoves?"true":"false")<<",\"leaf_policy\":"<<quote(r.leaf_policy)<<",\"features\":[";
    bool comma=false;for(auto& f:o.features){if(comma)out<<',';out<<quote(f);comma=true;}
    out<<"],\"prune_policy\":"<<quote(o.prune_policy)<<",\"prune_model\":"<<quote(o.prune_model)
       <<",\"prune_probability_override\":"<<o.prune_probability<<",\"prune_audit\":"<<(o.prune_audit?"true":"false")
       <<",\"stats\":{";comma=false;for(auto& [k,v]:r.stats){if(comma)out<<',';out<<quote(k)<<':'<<v;comma=true;}
    out<<"},\"candidates\":[";comma=false;for(auto& c:r.candidates){if(comma)out<<',';out<<"{\"score\":"<<c.score<<",\"pv\":"<<line_json(c.pv)<<'}';comma=true;}
    out<<"],\"fallback_move\":"<<(r.fallback_pv.empty()?"null":quote(usi(r.fallback_pv.front())))
       <<",\"fallback_pv\":"<<line_json(r.fallback_pv)<<",\"fallback_source\":"<<quote(r.fallback_source)
       <<",\"fallback_partial_score\":"<<(r.fallback_source=="completed_root_child"?std::to_string(r.fallback_score):"null")
       <<",\"completed_root_moves\":"<<r.completed_root_moves<<"}";return out.str();
}
}
