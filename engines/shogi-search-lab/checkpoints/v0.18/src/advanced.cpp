#include "advanced.hpp"
#include "positional.hpp"
#include "policy.hpp"
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
    return {"tt","history","capture-history","killer","counter","iid","etc","mate-distance",
        "qsearch","qcache","qguard","see-order","see-prune","delta","futility","reverse-futility",
        "razoring","null","adaptive-null","verified-null","lmr","history-lmr","check-extension",
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
// Freeze all priorities at node entry, then emit exactly the eager sort order.
// Child searches may update histories, but cannot reorder this node's tail.
struct OrderedMoves {
    struct Item {Move move;int64_t priority;uint64_t key;};
    static bool worse(const Item& a,const Item& b) {
        return a.priority!=b.priority?a.priority<b.priority:a.key>b.key;
    }
    std::vector<Item> heap;
    std::vector<Move> picked;
    explicit OrderedMoves(std::vector<Move> moves):picked(std::move(moves)){}
    OrderedMoves(std::vector<Item> items,bool lazy):heap(std::move(items)) {
        picked.reserve(heap.size());
        if(lazy&&heap.size()>16)std::make_heap(heap.begin(),heap.end(),worse);
        else {
            std::sort(heap.begin(),heap.end(),[](const Item& a,const Item& b){return worse(b,a);});
            for(auto& i:heap)picked.push_back(i.move);
            heap.clear();
        }
    }
    size_t size() const {return picked.size()+heap.size();}
    Move operator[](size_t i) {
        while(picked.size()<=i) {
            std::pop_heap(heap.begin(),heap.end(),worse);
            picked.push_back(heap.back().move);heap.pop_back();
        }
        return picked[i];
    }
    Move front(){return (*this)[0];}
    struct Iterator {
        OrderedMoves* owner;size_t index;
        Move operator*(){return (*owner)[index];}
        Iterator& operator++(){++index;return *this;}
        bool operator!=(const Iterator& other)const{return index!=other.index;}
    };
    Iterator begin(){return {this,0};}
    Iterator end(){return {this,size()};}
};
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
    MovePolicy policy;
    struct Flags {
        bool tt = false;
        bool history = false;
        bool capture_history = false;
        bool killer = false;
        bool counter = false;
        bool iid = false;
        bool etc = false;
        bool mate_distance = false;
        bool qsearch = false;
        bool qcache = false;
        bool qguard = false;
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
        bool history_lmr = false;
        bool check_extension = false;
        bool recapture_extension = false;
        bool singular = false;
        bool multicut = false;
        bool probcut = false;
        bool multiprobcut = false;
    } f;
    double start;
    std::unordered_map<Key,Entry,KeyHash> tt;
    std::unordered_map<uint64_t,Entry> qtt;
    // Hashes guide ordering only. Value-cache identities are collision-free path IDs.
    std::unordered_map<uint64_t,Move> hash_moves;
    std::unordered_map<std::pair<uint64_t,int>,uint64_t,PathHash> paths;
    uint64_t next_path=1;
    std::array<std::array<int,65536>,2> history{};
    std::array<std::array<int,16*81*16>,2> capture_history{};
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
    std::array<double,prune_dim> prune_cost_weights{};
    double prune_threshold=0,prune_logit=-1e100;
    double prune_cost_logit=1e100;
    bool learned=false,prune_enabled=false;
    uint64_t prune_events=0;
    uint64_t leaf_events=0;
    int iteration_depth=0;
    uint64_t slice_limit=0;
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
        if(slice_limit&&r.base.nodes>=slice_limit)throw Stop{"slice_limit"};
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
    int capture_key(Move m) const {
        const int pt=is_drop(m)?int(move_dropped_piece(m)):int(type_of(b.pos.piece_on(from_sq(m))));
        return (pt*81+int(to_sq(m)))*16+int(type_of(b.pos.piece_on(to_sq(m))));
    }
    void learn_captures(Move best,const std::vector<Move>& searched,int depth) {
        if(!f.capture_history||isolated||null_level||!tactical(best))return;
        const int bonus=std::min(1600,128+64*depth*depth);
        auto update=[&](Move m,int delta){auto& v=capture_history[b.pos.side_to_move()][capture_key(m)];v+=delta-v*std::abs(delta)/16384;};
        update(best,bonus);
        for(Move m:searched)if(m!=best&&tactical(m))update(m,-bonus/2);
        ++r.stats["capture_history_updates"];
    }
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
    OrderedMoves order(std::vector<Move> moves,int ply,Move preferred,Move previous) {
        struct Item {Move move; int64_t priority; uint64_t key; std::string text;};
        std::vector<Item> items; auto side=b.pos.side_to_move();
        std::vector<OrderedMoves::Item> compact;
        if(o.compact_ordering)compact.reserve(moves.size());else items.reserve(moves.size());
        r.stats[o.compact_ordering?"integer_order_keys":"string_order_keys"]+=moves.size();
        for(Move m:moves) {
            check();
            int64_t score=ordering_score(b,m);
            if(tactical(m)&&(o.policy_mode=="quiet"||(o.policy_mode=="root"&&ply>0)))score+=10000000;
            if(f.see_order&&tactical(m))score+=int64_t(see(m))*10000;
            if(f.history&&!tactical(m))score+=history[side][pack(m)];
            if(f.capture_history&&tactical(m))score+=4*capture_history[side][capture_key(m)];
            if(!o.policy_model.empty()&&o.policy_scale&&(o.policy_mode!="quiet"||!tactical(m))&&(o.policy_mode!="root"||ply==0)) {
                score+=int64_t(o.policy_scale)*policy.score(b,m)*(o.policy_mode=="quiet"?1:1024);
                ++r.stats["policy_moves_scored"];
            }
            if(f.killer&&ply<max_ply&&!tactical(m)) {
                if(m==killers[ply][0])score+=3000000;
                else if(m==killers[ply][1])score+=2000000;
            }
            if(f.counter&&previous!=MOVE_NONE&&m==counters[side][pack(previous)]&&!tactical(m))score+=1500000;
            if(m==preferred)score+=1000000000;
            if(o.compact_ordering)compact.push_back({m,score,usi_sort_key(m)});
            else items.push_back({m,score,0,usi(m)});
        }
        if(o.compact_ordering)return OrderedMoves(std::move(compact),o.lazy_ordering);
        std::sort(items.begin(),items.end(),[&](const Item&a,const Item&b){return a.priority!=b.priority?a.priority>b.priority:o.compact_ordering?a.key<b.key:a.text<b.text;});
        moves.clear();for(auto& i:items)moves.push_back(i.move);return OrderedMoves(std::move(moves));
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
    Value qsearch(int a,int beta,int ply,int left,uint64_t parent=0,Move incoming=MOVE_NONE,uint64_t path=0) {
        tick();++r.stats["qnodes"];
        r.stats["selective_depth"]=std::max(r.stats["selective_depth"],uint64_t(ply));
        const uint64_t node=r.base.nodes;
        const int original_a=a;
        const bool use_cache=f.qcache&&cacheable(path);
        auto finish=[&](Value v,const char* reason) {
            if(use_cache&&(qtt.size()<o.tt_capacity||qtt.count(path))) {
                const int flag=v.score<=original_a?-1:v.score>=beta?1:0;
                auto it=qtt.find(path);
                // Keep an exact value when a later bound is weaker.
                if(it==qtt.end()||it->second.flag!=0||flag==0) {
                    qtt[path]={local_score(v.score,ply),flag,v.pv.empty()?MOVE_NONE:v.pv.front(),v.pv};
                    ++r.stats["qtt_stores"];
                }
            }
            ++r.stats["qreturn_count"];r.stats["qreturn_ply_sum"]+=ply;
            ++r.stats["qreturn_ply_"+std::to_string(ply)];
            leaf_event("qreturn",node,parent,incoming,ply,left,original_a,beta,reason,true,v.score,v.pv);return v;
        };
        if(!null_level)if(auto rep=b.repetition_score(ply))return finish({*rep,{}},"repetition");
        if(use_cache) {
            ++r.stats["qtt_probes"];const auto it=qtt.find(path);
            if(it!=qtt.end()) {
                ++r.stats["qtt_hits"];const auto& e=it->second;const int score=root_score(e.score,ply);
                if(e.flag==0||(e.flag>0&&score>=beta)||(e.flag<0&&score<=a)) {
                    ++r.stats["qtt_cutoffs"];
                    // Do not overwrite a cached bound as if it were a new search.
                    return {score,e.pv};
                }
            }
        }
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
            if(left<=0&&o.driver!="adaptive"){++r.base.leaves;if(deferred)++r.stats["q_avoided_generations"];return finish(best,"qdepth_limit");}
            if(stand>=beta){++r.stats["qstand_cutoffs"];if(deferred)++r.stats["q_avoided_generations"];return finish(best,"stand_pat_cutoff");}
            a=std::max(a,stand);
            if(deferred)generate();
            moves.erase(std::remove_if(moves.begin(),moves.end(),[&](Move m){return !tactical(m);}),moves.end());
        }
        auto ordered=order(std::move(moves),ply,MOVE_NONE,MOVE_NONE);
        int move_index=0;bool learned_cut=false;std::vector<Move> captures_searched;
        for(Move m:ordered) {
            const int index=move_index++;
            const bool checkmove=b.pos.gives_check(m);
            if(f.qguard&&!isolated&&!null_level&&!checked&&!checkmove&&!is_drop(m)&&!is_promote(m)
                &&b.pos.piece_on(to_sq(m))!=NO_PIECE&&type_of(b.pos.piece_on(from_sq(m)))!=KING
                &&(incoming==MOVE_NONE||to_sq(incoming)!=to_sq(m))) {
                auto distance=[](Square x,Square y){return std::max(std::abs(int(x)/9-int(y)/9),std::abs(int(x)%9-int(y)%9));};
                if(distance(to_sq(m),b.pos.king_square(BLACK))>2&&distance(to_sq(m),b.pos.king_square(WHITE))>2) {
                    ++r.stats["qguard_probes"];
                    // A material-exchange heuristic, not a safe minimax bound.
                    // Eligibility depends on the position/path, not window or move rank.
                    if(!b.pos.see_ge(m,::Value(0))) {
                        ++r.stats["qguard_prunes"];
                        if(o.qguard_audit) {
                            const auto before=r.base.nodes;Value reference;
                            {struct Guard{int& n;Guard(int& x):n(x){++n;}~Guard(){--n;}} guard(isolated);
                             PlayedMove played(b,m);reference=qsearch(-beta,-a,ply+1,left-1,node,m);}
                            ++r.stats["qguard_audits"];r.stats["qguard_audit_nodes"]+=r.base.nodes-before;
                            if(-reference.score>a)++r.stats["qguard_missed_alpha"];
                            if(trace.is_open()&&events++<o.limits.trace_limit)
                                trace<<"{\"event\":\"qguard_audit\",\"sfen\":"<<quote(b.pos.sfen())<<",\"move\":"<<quote(usi(m))
                                  <<",\"alpha\":"<<a<<",\"score\":"<<-reference.score<<",\"pv\":"<<line_json(reference.pv)<<"}\n";
                        }
                        continue;
                    }
                }
            }
            if(!checked&&!checkmove&&!isolated) {
                if(f.delta&&stand+gain(m)+200<a){++r.stats["delta_prunes"];continue;}
                if(f.see_prune&&see(m)<0){++r.stats["see_prunes"];continue;}
            }
            const bool eligible=prune_enabled&&!checked&&!checkmove&&!isolated&&!null_level&&
              !is_drop(m)&&!is_promote(m)&&b.pos.piece_on(to_sq(m))!=NO_PIECE&&
              beta-a==1&&std::abs(a)<8000&&std::abs(stand)<8000;
            // Cheap protected-move checks precede hand/king feature construction.
            const bool consider=eligible&&(o.prune_policy=="collect"||o.prune_policy=="direct"||
              (!learned_cut&&index>=2&&left>=3&&(incoming==MOVE_NONE||to_sq(incoming)!=to_sq(m))&&
               type_of(b.pos.piece_on(from_sq(m)))!=KING&&a-stand>=gain(m)*.9));
            std::array<double,prune_dim> x{};bool guarded=false;
            std::string parent_sfen;
            if(consider){
                ++r.stats["learned_eligible"];
                x=prune_features(m,incoming,a,stand,left,index,int(ordered.size()));
                guarded=index>=2&&left>=3&&x[8]==0&&x[9]==0&&x[15]==0&&x[2]>=0&&!learned_cut;
                if(prune_log.is_open())parent_sfen=b.pos.sfen();
                if(guarded)++r.stats["learned_guard_eligible"];
                double logit=0;bool in_domain=true;
                for(int j=0;j<prune_dim;++j){logit+=x[j]*prune_weights[j];if(x[j]<prune_low[j]-1e-9||x[j]>prune_high[j]+1e-9)in_domain=false;}
                bool skip=learned&&prune_threshold>0&&logit<=prune_logit;
                if(o.prune_policy!="direct")skip=skip&&guarded&&in_domain;
                if(skip&&o.prune_policy=="efficient"){
                    double cost_logit=0;for(int j=0;j<prune_dim;++j)cost_logit+=x[j]*prune_cost_weights[j];
                    skip=cost_logit>=prune_cost_logit;
                }
                if(skip&&(o.prune_policy=="verified"||o.prune_policy=="staticcheck")) {
                    ++r.stats["learned_verifications"];const uint64_t before=r.base.nodes;
                    // A shallow bound is evidence only, not a proof at the original q depth.
                    const int threshold=a-90;Value shallow;
                    {struct Guard{int& n;Guard(int& x):n(x){++n;}~Guard(){--n;}} guard(isolated);
                     PlayedMove move(b,m);shallow=qsearch(-threshold-1,-threshold,ply+1,o.prune_policy=="staticcheck"?0:1,node,m);}
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
            const auto qpath=use_cache?child_path(path,m):0;
            Value c;{PlayedMove move(b,m);c=qsearch(-beta,-a,ply+1,left-1,node,m,qpath);}
            if(consider)prune_row("observed",parent_sfen,m,a,stand,left,index,x,-c.score,r.base.nodes-before,guarded);
            if(-c.score>best.score){best={-c.score,{m}};best.pv.insert(best.pv.end(),c.pv.begin(),c.pv.end());}
            if(f.capture_history&&tactical(m))captures_searched.push_back(m);
            a=std::max(a,best.score);if(a>=beta){++r.base.cutoffs;learn_captures(m,captures_searched,std::max(1,left));return finish(best,"child_beta_cutoff");}
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
        auto ordered=order(std::move(moves),ply,preferred,prev);
        if(f.etc&&cacheable(path)&&d>=2) {
            for(Move m:ordered) {
                check();++r.stats["etc_probes"];auto id=child_path(path,m);
                auto found=tt.find({id,d-1,ext});
                if(found!=tt.end()&&found->second.flag<=0) {
                    int s=-root_score(found->second.score,ply+1);
                    if(s>=beta){++r.stats["etc_cutoffs"];Value v{s,{m}};v.pv.insert(v.pv.end(),found->second.pv.begin(),found->second.pv.end());return finish(v);}
                }
            }
        }
        if(eligible&&f.multicut&&d>=3) {
            int cuts=0;for(size_t i=0;i<std::min<size_t>(6,ordered.size());++i){Move m=ordered[i];Value v;++r.stats["multicut_probes"];{PlayedMove move(b,m);v=probe(d-3,-beta,-beta+1,ply+1,m);}if(-v.score>=beta)++cuts;if(cuts>=3){++r.stats["multicut_prunes"];event("multicut",d,ply,a,beta,beta,true);return finish({beta,{}});}}
        }
        Move singular=MOVE_NONE;
        if(f.singular&&!isolated&&d>=4&&ext>0&&preferred!=MOVE_NONE&&ordered.front()==preferred) {
            ++r.stats["singular_probes"];int candidate;
            {PlayedMove move(b,preferred);candidate=-probe(d-3,-infinity,infinity,ply+1,preferred).score;}
            int threshold=candidate-150;bool unique=std::abs(candidate)<90000;
            for(Move m:ordered)if(m!=preferred&&unique){PlayedMove move(b,m);if(-probe(d-3,-threshold,-threshold+1,ply+1,m).score>=threshold)unique=false;}
            if(unique){singular=preferred;++r.stats["singular_confirmed"];}
        }
        Value best{-infinity,{}};size_t index=0;std::vector<Move> quiet_searched,captures_searched;
        const Color side=b.pos.side_to_move();
        for(Move m:ordered) {
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
            bool reduce=!isolated&&(f.lmr||f.history_lmr)&&d>=3&&index>=4&&!checked&&!noise&&!gives&&!is_drop(m)&&extension==0;
            int reduction=(d>=6&&index>=12)?2:1;
            if(reduce&&f.history_lmr) {
                // Conservative protection, plus one extra ply only for late
                // non-PV moves with negative online history. No trained model.
                const bool protected_move=m==preferred||m==killers[ply][0]||m==killers[ply][1]
                    ||(prev!=MOVE_NONE&&m==counters[side][pack(prev)])||history[side][pack(m)]>=1024;
                if(pvnode||protected_move){--reduction;++r.stats["history_lmr_protections"];}
                else if(d>=5&&index>=8&&history[side][pack(m)]<0){++reduction;++r.stats["history_lmr_extra"];}
                reduction=std::clamp(reduction,0,std::max(0,nd-1));
                reduce=reduction>0;
            }
            Value c;auto id=child_path(path,m);
            if(ply==0)current_root_move=m;
            {
                PlayedMove move(b,m);
                if(reduce) {
                    ++r.stats["lmr_reductions"];
                    int red=reduction;
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
            else if(f.capture_history)captures_searched.push_back(m);
            if(a>=beta) {
                ++r.base.cutoffs;r.base.skipped_siblings+=ordered.size()-index-1;
                learn_captures(m,captures_searched,d);
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
    // Fractional effort, not a uniform ply horizon. Edge costs are hand-tuned
    // priority scores, NOT calibrated probabilities. No fixed top-k exclusion.
    Value adaptive(int effort,int a,int beta,int ply,uint64_t path,Move prev) {
        r.stats["selective_depth"]=std::max(r.stats["selective_depth"],uint64_t(ply));
        if(effort<=0)return qsearch(a,beta,ply,0,0,prev,path);
        tick();++r.stats["adaptive_nodes"];
        if(ply>=max_ply-1)throw Stop{"ply_limit"};
        if(auto rep=b.repetition_score(ply))return {*rep,{}};
        auto moves=b.legal_moves();
        if(moves.empty()){++r.base.terminals;return {-mate+ply,{}};}
        const int original_a=a;const Key key{path,effort,0};
        Move preferred=MOVE_NONE;
        if(f.tt){
            auto hint=hash_moves.find(uint64_t(b.pos.key()));if(hint!=hash_moves.end())preferred=hint->second;
            if(cacheable(path)){
                ++r.stats["tt_probes"];auto it=tt.find(key);
                if(it!=tt.end()){
                    ++r.stats["tt_hits"];const auto& e=it->second;int s=root_score(e.score,ply);preferred=e.move;
                    if(e.flag==0||(e.flag>0&&s>=beta)||(e.flag<0&&s<=a)){++r.stats["tt_cutoffs"];return {s,e.pv};}
                }
            }
        }
        const bool checked=b.pos.in_check();const Color side=b.pos.side_to_move();
        std::unordered_map<int,double> priors;
        if(o.policy_mode=="cost") {
            double maximum=-1e100,sum=0;
            for(Move m:moves){double x=policy.score(b,m)/1024.0;priors[pack(m)]=x;maximum=std::max(maximum,x);}
            for(auto& x:priors){x.second=std::exp(x.second-maximum);sum+=x.second;}
            for(auto& x:priors)x.second=.9*x.second/sum+.1/moves.size();
        }
        auto ordered=order(std::move(moves),ply,preferred,prev);
        r.stats["max_legal_width"]=std::max(r.stats["max_legal_width"],uint64_t(ordered.size()));
        Value best{-infinity,{}};size_t index=0;std::vector<Move> captures,quiets;
        for(Move m:ordered){
            const bool noise=tactical(m),gives=b.pos.gives_check(m);
            const bool protected_move=m==preferred||m==killers[ply][0]||m==killers[ply][1]
                ||(prev!=MOVE_NONE&&m==counters[side][pack(prev)]);
            int cost=4;
            if(ply>0){
                if(ordered.size()==1)cost=1;
                else if(checked||gives||(noise&&prev!=MOVE_NONE&&to_sq(m)==to_sq(prev)))cost=3;
                else if(protected_move)cost=3;
                else if(noise||is_drop(m))cost=4;
                else {
                    cost=std::clamp(4+int(std::log2(double(index)+1.0)*2)-history[side][pack(m)]/1024,3,12);
                }
                if(o.policy_mode=="cost"&&ordered.size()>1) {
                    // Relative surprise around a uniform branch; not a literal RPS reproduction.
                    cost=std::clamp(4+int(std::lround(-2*std::log2(priors[pack(m)]*ordered.size()))),2,12);
                    if(checked||gives||(noise&&prev!=MOVE_NONE&&to_sq(m)==to_sq(prev)))cost=std::min(cost,3);
                    if(protected_move)cost=std::min(cost,3);
                    if(index==0)cost=std::min(cost,4);
                }
            }
            ++r.stats["edge_cost_"+std::to_string(cost)];
            Value c;const auto id=child_path(path,m);const auto before=r.base.nodes;
            if(ply==0)current_root_move=m;
            {
                PlayedMove move(b,m);
                if(cost>4){
                    ++r.stats["adaptive_reductions"];
                    c=adaptive(effort-cost,-a-1,-a,ply+1,id,m);
                    if(-c.score>a&&o.policy_mode=="cost"&&cost>=8){
                        ++r.stats["intermediate_researches"];c=adaptive(effort-(cost+4)/2,-a-1,-a,ply+1,id,m);
                    }
                    if(-c.score>a){++r.stats["adaptive_researches"];c=adaptive(effort-4,-beta,-a,ply+1,id,m);}
                }else if(index>0&&beta-a>1){
                    ++r.stats["pvs_probes"];c=adaptive(effort-cost,-a-1,-a,ply+1,id,m);
                    if(-c.score>a&&-c.score<beta){++r.stats["pvs_researches"];c=adaptive(effort-cost,-beta,-a,ply+1,id,m);}
                }else c=adaptive(effort-cost,-beta,-a,ply+1,id,m);
            }
            if(ply==0)r.stats["root_nodes_"+usi(m)]+=r.base.nodes-before;
            if(-c.score>best.score){best={-c.score,{m}};best.pv.insert(best.pv.end(),c.pv.begin(),c.pv.end());}
            if(ply==0&&!r.base.has_result){++r.completed_root_moves;partial_root=best;}
            a=std::max(a,best.score);
            if(noise)captures.push_back(m);else quiets.push_back(m);
            if(a>=beta){
                ++r.base.cutoffs;r.base.skipped_siblings+=ordered.size()-index-1;
                learn_captures(m,captures,std::max(1,effort/4));
                if(!noise){
                    if(f.killer&&killers[ply][0]!=m){killers[ply][1]=killers[ply][0];killers[ply][0]=m;}
                    if(f.history){
                        const int bonus=std::min(2000,32*(1+effort/4)*(1+effort/4));
                        auto update=[&](Move h,int delta){auto& v=history[side][pack(h)];v+=delta-v*std::abs(delta)/16384;};
                        update(m,bonus);for(Move h:quiets)if(h!=m)update(h,-bonus/2);
                    }
                    if(f.counter&&prev!=MOVE_NONE)counters[side][pack(prev)]=m;
                }
                break;
            }
            ++index;
        }
        if(f.tt&&!best.pv.empty()){
            if(hash_moves.size()<o.tt_capacity||hash_moves.count(uint64_t(b.pos.key())))hash_moves[uint64_t(b.pos.key())]=best.pv.front();
            if(cacheable(path)&&(tt.size()<o.tt_capacity||tt.count(key)))tt[key]={local_score(best.score,ply),best.score<=original_a?-1:best.score>=beta?1:0,best.pv.front(),best.pv};
        }
        return best;
    }
    Value rps(int budget,int a,int beta,int ply,Move prev) {
        if(budget<=0&&f.qsearch)return qsearch(a,beta,ply,o.qdepth,0,prev);
        tick();++r.stats["rps_nodes"];
        if(ply>=max_ply-1)throw Stop{"ply_limit"};
        if(auto rep=b.repetition_score(ply))return {*rep,{}};
        auto moves=b.legal_moves();if(moves.empty())return {-mate+ply,{}};
        if(budget<=0){++r.base.leaves;return {eval(b),{}};}
        auto ordered=order(std::move(moves),ply,MOVE_NONE,prev);
        Value best{-infinity,{}};size_t index=0;
        for(Move m:ordered) {
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
            int cost=ordered.size()==1?0:int(std::lround(-std::log2(p)*1000));
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
        if(o.driver=="adaptive")return adaptive(d*4,-infinity,infinity,0,1,MOVE_NONE);
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
        auto ordered=order(std::move(moves),0,MOVE_NONE,MOVE_NONE);
        std::vector<AdvancedLine> lines;
        for(Move m:ordered) {
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
    void allocated_root() {
        if(auto rep=b.repetition_score(0)){r.base.has_result=true;r.base.score=*rep;r.base.complete=true;r.base.stop_reason="terminal";return;}
        auto legal=b.legal_moves();
        if(legal.empty()){r.base.has_result=true;r.base.score=-mate;r.base.complete=true;r.base.stop_reason="terminal";return;}
        struct Arm {Move move;double prior=0,change=200;int score=0,effort=0,completed=-1;uint64_t attempts=0,nodes=0,quantum=256;std::vector<Move> pv;};
        std::vector<Arm> arms;double maximum=-1e100,total_prior=0;
        for(Move m:legal){
            check();Arm x;x.move=m;x.prior=o.policy_model.empty()?0:policy.score(b,m)/1024.0;maximum=std::max(maximum,x.prior);
            {PlayedMove played(b,m);x.score=-eval(b);} // Priority only, never published as a completed qsearch.
            arms.push_back(x);
        }
        for(auto& x:arms){x.prior=std::exp(x.prior-maximum);total_prior+=x.prior;}
        for(auto& x:arms)x.prior=.9*x.prior/total_prior+.1/arms.size();
        std::stable_sort(arms.begin(),arms.end(),[](const Arm&a,const Arm&c){return a.prior>c.prior;});
        std::vector<size_t> active;for(size_t i=0;i<arms.size();i++)active.push_back(i);
        uint64_t steps=0,round=0;size_t cursor=0;int stage=0;
        auto publish=[&](){
            r.candidates.clear();r.completed_root_moves=0;int minimum=1000000;
            for(auto& x:arms)if(x.completed>=0){++r.completed_root_moves;minimum=std::min(minimum,x.completed);r.candidates.push_back({x.score,x.pv});}
            std::sort(r.candidates.begin(),r.candidates.end(),[](const auto&a,const auto&c){return a.score!=c.score?a.score>c.score:usi(a.pv[0])<usi(c.pv[0]);});
            if(!r.candidates.empty()){
                partial_root={r.candidates.front().score,r.candidates.front().pv};
                // Complete coverage is distinct from heterogeneous per-arm effort.
                r.base.has_result=r.completed_root_moves==arms.size();
                if(r.base.has_result){r.base.score=partial_root.score;r.base.pv=partial_root.pv;r.base.completed_depth=minimum/4+1;}
            }
        };
        try{while(true){
            check();size_t pick=0;
            if(steps<arms.size())pick=steps;
            else if(o.root_scheduler=="roundrobin")pick=steps%arms.size();
            else if(o.root_scheduler=="halving"){
                if(cursor>=active.size()){
                    cursor=0;++round;
                    if(round%2==0&&active.size()>1){
                        std::stable_sort(active.begin(),active.end(),[&](size_t i,size_t j){
                            const double a=arms[i].score+(arms[i].completed<0?400:0),c=arms[j].score+(arms[j].completed<0?400:0);return a>c;
                        });active.resize((active.size()+1)/2);++stage;
                    }
                    if(active.size()==1&&round%4==0){active.clear();for(size_t i=0;i<arms.size();i++)active.push_back(i);++r.stats["halving_reentries"];}
                }
                pick=active[cursor++];
            }else{
                double best=-1e100;int leader=-infinity;for(auto& x:arms)if(x.completed>=0)leader=std::max(leader,x.score);
                for(size_t i=0;i<arms.size();i++){
                    const auto& x=arms[i];double priority;
                    if(o.root_scheduler=="reliability"){
                        const double gap=leader==-infinity?0:std::max(0,leader-x.score);
                        priority=(x.change+200/(1+x.completed/4.0)+1000*x.prior)/(std::sqrt(double(x.quantum))*(1+gap/200.0));
                        if(x.completed<0)priority+=1000/(1+x.attempts);
                    }else priority=std::tanh(x.score/600.0)+3*x.prior*std::sqrt(double(steps))/(1+x.attempts);
                    // Periodic probes revisit every arm; no permanent learned exclusion.
                    if(steps%(arms.size()*4)==i*4)priority+=10;
                    if(priority>best){best=priority;pick=i;}
                }
            }
            Arm& x=arms[pick];++steps;++x.attempts;const uint64_t before=r.base.nodes;
            slice_limit=before+x.quantum;current_root_move=x.move;iteration_depth=x.effort/4+1;
            const auto path=child_path(1,x.move);
            try{
                Value v;{PlayedMove played(b,x.move);v=adaptive(x.effort,-infinity,infinity,1,path,x.move);}
                const int score=-v.score;x.change=.5*x.change+.5*std::min(2000,std::abs(score-x.score));x.score=score;
                x.completed=x.effort;x.effort+=4;x.pv={x.move};x.pv.insert(x.pv.end(),v.pv.begin(),v.pv.end());
                x.quantum=std::max<uint64_t>(256,2*(r.base.nodes-before));++r.stats["root_slice_completed"];
            }catch(const Stop& stop){
                if(std::string(stop.reason)!="slice_limit")throw;
                x.quantum=std::min<uint64_t>(1000000000,x.quantum*2);++r.stats["root_slice_interrupted"];
            }
            slice_limit=0;x.nodes+=r.base.nodes-before;
            r.stats["root_nodes_"+usi(x.move)]=x.nodes;r.stats["root_attempts_"+usi(x.move)]=x.attempts;
            r.stats["root_effort_"+usi(x.move)]=x.completed<0?0:x.completed+4;
            publish();
        }}catch(const Stop& stop){slice_limit=0;publish();r.base.stop_reason=stop.reason;}
        r.stats["root_arms"]=arms.size();r.stats["root_covered"]=r.completed_root_moves;r.stats["halving_stages"]=stage;
        // TT entries and ordering history survive slices. Recursive stacks do not.
    }
public:
    AdvancedResult r;
    Worker(Board& board,const AdvancedOptions& options):b(board),o(options),eval(o.evaluation,o.evaluation_model,o.evaluation_head),policy(o.policy_model) {
        if(o.policy_scale<0||o.policy_scale>16)throw std::invalid_argument("Policy scale must be 0..16");
        if(o.policy_mode!="quiet"&&o.policy_mode!="root"&&o.policy_mode!="all"&&o.policy_mode!="cost")throw std::invalid_argument("Unknown policy mode");
        if(o.policy_mode!="quiet"&&o.policy_model.empty())throw std::invalid_argument("All-move/cost policy requires model");
        if(o.policy_mode=="cost"&&o.driver!="adaptive")throw std::invalid_argument("Policy cost requires adaptive driver");
        const std::set<std::string> schedulers={"off","roundrobin","puct","halving","reliability"};
        if(!schedulers.count(o.root_scheduler)||(o.root_scheduler!="off"&&o.driver!="adaptive"))throw std::invalid_argument("Invalid root scheduler");
        f.tt=o.features.count("tt")!=0;
        f.history=o.features.count("history")!=0;
        f.capture_history=o.features.count("capture-history")!=0;
        f.killer=o.features.count("killer")!=0;
        f.counter=o.features.count("counter")!=0;
        f.iid=o.features.count("iid")!=0;
        f.etc=o.features.count("etc")!=0;
        f.mate_distance=o.features.count("mate-distance")!=0;
        f.qsearch=o.features.count("qsearch")!=0;
        f.qcache=on("qcache");f.qguard=on("qguard");
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
        f.history_lmr=o.features.count("history-lmr")!=0;
        f.check_extension=o.features.count("check-extension")!=0;
        f.recapture_extension=o.features.count("recapture-extension")!=0;
        f.singular=o.features.count("singular")!=0;
        f.multicut=o.features.count("multicut")!=0;
        f.probcut=o.features.count("probcut")!=0;
        f.multiprobcut=o.features.count("multiprobcut")!=0;

        const auto known=advanced_features();for(auto& f:o.features)if(!known.count(f))throw std::invalid_argument("Unknown feature "+f);
        const std::set<std::string> drivers={"ab","pvs","aspiration","mtdf","sss","dual","rps","erps","adaptive"};
        if(!drivers.count(o.driver))throw std::invalid_argument("Unknown driver");
        if(o.limits.depth<0||o.limits.depth>16||!o.limits.max_nodes||o.limits.time_ms>3600000||o.multipv<1||o.multipv>5||o.qdepth<0||o.qdepth>16||o.extension_budget<0||o.extension_budget>8||o.tt_capacity<1||o.tt_capacity>1000000||o.aspiration<1||o.aspiration>10000)throw std::invalid_argument("Invalid advanced limits");
        const std::set<std::string> selective={"see-prune","delta","futility","reverse-futility","razoring","null","adaptive-null","verified-null","lmr","history-lmr","multicut","probcut","multiprobcut"};
        for(auto& f:selective)if(on(f))r.selective=true;
        const std::set<std::string> prune_policies={"off","collect","direct","guarded","verified","staticcheck","efficient"};
        if(!prune_policies.count(o.prune_policy))throw std::invalid_argument("Unknown learned prune policy");
        prune_enabled=o.prune_policy!="off";learned=prune_enabled&&o.prune_policy!="collect";
        if(!std::isfinite(o.prune_probability)||(o.prune_probability!=-1&&(o.prune_probability<0||o.prune_probability>=1)))throw std::invalid_argument("Prune probability must be -1 or [0,1)");
        if(prune_enabled){
            if(o.evaluation!="nnue"||!f.qsearch||o.qdepth!=6||r.selective||o.driver!="pvs")throw std::invalid_argument("Learned pruning requires nnue, PVS, qdepth 6 and nonselective features");
            if(learned){
                std::ifstream input(o.prune_model);std::string header;
                if(!std::getline(input,header)||(header!="shogi-lab-alpha-risk-v1 nnue_raw90 qdepth6 dim17"&&header!="shogi-lab-alpha-risk-v2 nnue_raw90 qdepth6 dim17"))throw std::invalid_argument("Invalid learned prune model header");
                if(!(input>>prune_threshold)||!std::isfinite(prune_threshold)||prune_threshold<0||prune_threshold>=1)throw std::invalid_argument("Invalid prune calibration");
                for(auto* row:{&prune_weights,&prune_low,&prune_high})for(double& v:*row)if(!(input>>v)||!std::isfinite(v))throw std::invalid_argument("Invalid prune coefficients");
                if(header.find("-v2 ")!=std::string::npos){
                    double cost_threshold;
                    if(!(input>>cost_threshold)||!std::isfinite(cost_threshold)||cost_threshold<=0||cost_threshold>=1)throw std::invalid_argument("Invalid cost calibration");
                    prune_cost_logit=std::log(cost_threshold/(1-cost_threshold));
                    for(double& v:prune_cost_weights)if(!(input>>v)||!std::isfinite(v))throw std::invalid_argument("Invalid cost coefficients");
                }else if(o.prune_policy=="efficient")throw std::invalid_argument("Efficient policy needs v2 cost model");
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
        if(o.driver=="adaptive") {
            if(o.multipv!=1||!f.qsearch||prune_enabled)throw std::invalid_argument("Adaptive requires MultiPV=1, qsearch, no learned pruning");
            for(const auto& x:o.features)if(x!="tt"&&x!="history"&&x!="capture-history"&&x!="killer"&&x!="counter"&&x!="mate-distance")
                if(x!="qsearch"&&x!="qcache"&&x!="qguard")throw std::invalid_argument("Unsupported adaptive feature: "+x);
            r.selective=true;
        }
        if((on("qcache")||on("qguard"))&&o.driver!="adaptive")throw std::invalid_argument("qcache/qguard require adaptive driver");
        if(on("qcache")&&!f.tt)throw std::invalid_argument("qcache requires history-safe tt paths");
        if(o.qguard_audit&&!on("qguard"))throw std::invalid_argument("qguard audit requires qguard");
        r.leaf_policy=f.qsearch?"bounded_quiescence":"fixed_"+o.evaluation;
        if(o.driver=="adaptive")r.leaf_policy="fractional_effort+quiescence_until_quiet";
        if(on("qguard"))r.leaf_policy+="+guarded_see";
        if(o.root_scheduler!="off")r.leaf_policy+="+root_slices_"+o.root_scheduler;
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
        const bool adaptive_mode=o.driver=="adaptive";
        int first=adaptive_mode?1:o.limits.iterative&&o.limits.depth>0?1:o.limits.depth;
        const int last=adaptive_mode?1000000:o.limits.depth;
        try {
            if(o.root_scheduler!="off")allocated_root();
            else for(int d=first;d<=last;++d) {
                iteration_depth=d;current_root_move=MOVE_NONE;
                uint64_t before=r.base.nodes;double t=now();Value v;std::vector<AdvancedLine> lines;
                if(o.multipv>1&&d>0){lines=rank(d);v={lines.front().score,lines.front().pv};}
                else {v=root(d,r.base.has_result?r.base.score:eval(b));if(!v.pv.empty())lines.push_back({v.score,v.pv});}
                r.base.score=v.score;r.base.pv=v.pv;r.candidates=std::move(lines);
                r.base.has_result=true;r.base.completed_depth=d;
                r.base.iterations.push_back({d,v.score,r.base.nodes-before,0,now()-t,v.pv});
                if(!adaptive_mode&&d==o.limits.depth){r.base.complete=true;r.base.stop_reason="depth_limit";}
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
        if(on("qcache"))r.stats["qtt_entries"]=qtt.size();
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
        <<",\"lazy_ordering\":"<<(o.lazy_ordering?"true":"false")<<",\"defer_qmoves\":"<<(o.defer_qmoves?"true":"false")<<",\"leaf_policy\":"<<quote(r.leaf_policy)<<",\"features\":[";
    bool comma=false;for(auto& f:o.features){if(comma)out<<',';out<<quote(f);comma=true;}
    out<<"],\"iteration_unit\":"<<quote(o.driver=="adaptive"?"effort_steps_4":"plies")<<",\"evaluation_head\":"<<quote(o.evaluation_head);
    out<<",\"policy_model\":"<<quote(o.policy_model)<<",\"policy_scale\":"<<o.policy_scale
       <<",\"policy_mode\":"<<quote(o.policy_mode)<<",\"root_scheduler\":"<<quote(o.root_scheduler)
       <<",\"prune_policy\":"<<quote(o.prune_policy)<<",\"prune_model\":"<<quote(o.prune_model)
       <<",\"prune_probability_override\":"<<o.prune_probability<<",\"prune_audit\":"<<(o.prune_audit?"true":"false")
       <<",\"stats\":{";comma=false;for(auto& [k,v]:r.stats){if(comma)out<<',';out<<quote(k)<<':'<<v;comma=true;}
    out<<"},\"candidates\":[";comma=false;for(auto& c:r.candidates){if(comma)out<<',';out<<"{\"score\":"<<c.score<<",\"pv\":"<<line_json(c.pv)<<'}';comma=true;}
    out<<"],\"fallback_move\":"<<(r.fallback_pv.empty()?"null":quote(usi(r.fallback_pv.front())))
       <<",\"fallback_pv\":"<<line_json(r.fallback_pv)<<",\"fallback_source\":"<<quote(r.fallback_source)
       <<",\"fallback_partial_score\":"<<(r.fallback_source=="completed_root_child"?std::to_string(r.fallback_score):"null")
       <<",\"completed_root_moves\":"<<r.completed_root_moves<<"}";return out.str();
}
}
