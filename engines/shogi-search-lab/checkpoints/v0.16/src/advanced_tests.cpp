#include "advanced.hpp"
#include "session.hpp"
#include <algorithm>
#include <iostream>
#include <random>
#include <stdexcept>

namespace lab {
int advanced_selftest() {
    int checks=0;
    auto require=[&](bool ok,const std::string& label){++checks;if(!ok)throw std::runtime_error("Advanced test: "+label);};
    // Exact move-set comparison includes quiet promotions (not only pawns),
    // underpromotions, pinned captures, all evasions, drops and no-legal-move.
    std::vector<std::string> move_cases={SFEN_HIRATE,
        "4k4/9/P8/9/9/9/9/9/4K4 b - 1",
        "4k4/9/2S6/9/4B4/9/9/9/4K4 b RNL 1",
        "4k3p/9/8L/9/9/9/9/9/K8 b - 1",
        "3pk4/9/4N4/9/9/9/9/9/K8 b - 1",
        "k8/9/9/9/9/9/4n4/9/3PK4 w - 1",
        "4k4/9/9/9/9/4r4/9/9/4K4 b G 1",
        "k3r4/9/9/9/9/9/4G4/9/4K4 b P 1",
        "k6r1/9/9/9/9/9/9/6r2/8K b - 1",
        "k6r1/9/9/9/9/9/9/6r2/8K b P 1",
        "3lkl3/3pGp3/4R4/9/9/9/9/9/K8 w - 1"};
    uint64_t move_positions=0,move_count=0;
    auto compare_moves=[&](Board& board) {
        auto legal=board.legal_moves(),expected=legal;
        if(!board.pos.in_check())expected.erase(std::remove_if(expected.begin(),expected.end(),[&](Move m){return !is_promote(m)&&board.pos.piece_on(to_sq(m))==NO_PIECE;}),expected.end());
        auto actual=board.tactical_moves();
        std::sort(expected.begin(),expected.end());std::sort(actual.begin(),actual.end());
        require(expected==actual,"direct tactical move set: "+board.pos.sfen());
        require(board.has_legal_move()==!legal.empty(),"legal-move existence witness");
        auto text=legal,key=legal;
        std::sort(text.begin(),text.end(),[](Move a,Move b){return usi(a)<usi(b);});
        std::sort(key.begin(),key.end(),[](Move a,Move b){return usi_sort_key(a)<usi_sort_key(b);});
        require(text==key,"integer ordering preserves exact USI lexical order");
        ++move_positions;move_count+=legal.size();
    };
    for(const auto& sfen:move_cases){Board board(sfen);compare_moves(board);}
    std::mt19937 move_rng(20260923);
    for(int game=0;game<8;++game) {
        Board board(move_cases[game%move_cases.size()]);
        for(int ply=0;ply<200;++ply) {
            compare_moves(board);auto legal=board.legal_moves();
            if(legal.empty()||board.repetition_score(0))break;
            board.play_input(usi(legal[move_rng()%legal.size()]));
        }
    }
    std::vector<std::string> sfens={SFEN_HIRATE,"4k4/9/P8/9/9/9/9/9/4K4 b - 1","k3r4/9/9/9/9/9/4G4/9/4K4 b P 1","3lkl3/3pGp3/4R4/9/9/9/9/9/K8 w - 1"};
    std::mt19937 rng(20260921);Board generated;
    for(int n=0;n<48;++n){auto legal=generated.legal_moves();if(legal.empty()||generated.repetition_score(0))break;generated.play_input(usi(legal[rng()%legal.size()]));if(n%4==3)sfens.push_back(generated.pos.sfen());}
    for(auto& sfen:sfens) {
        Board b(sfen);auto before=b.pos.sfen();auto h=b.history.size();
        Options ref;ref.algorithm=Algorithm::minimax;ref.depth=2;ref.max_nodes=10000000;
        auto truth=search(b,ref);require(truth.complete,"minimax oracle completed");
        for(std::string driver:{"ab","pvs","aspiration","mtdf","sss","dual"}) {
            AdvancedOptions o;set_advanced_preset(o,"exact");o.driver=driver;o.limits.depth=2;o.limits.iterative=true;
            auto r=advanced_search(b,o);require(r.base.complete&&r.base.score==truth.score,"exact driver score "+driver);
            if(driver=="dual"||driver=="sss")require(r.stats["mtd_passes"]<128,"finite mate bounds prevent sentinel crawl");
            require(b.pos.sfen()==before&&b.history.size()==h,"restored "+driver);
            if(!r.base.pv.empty()) {
                PlayedMove m(b,r.base.pv[0]);ref.depth=1;auto c=search(b,ref);int score=-c.score;if(score>90000)--score;if(score< -90000)++score;
                require(c.complete&&score==truth.score,"optimal root move "+driver);ref.depth=2;
            }
        }
        for(auto feature:{"history","killer","counter","iid","etc","mate-distance","see-order"}) {
            AdvancedOptions o;o.features={"tt",feature};o.limits.depth=2;
            auto r=advanced_search(b,o);require(r.base.complete&&r.base.score==truth.score,std::string("feature exact ")+feature);
        }
    }
    Board start;
    // A completed child can guide emergency play, but must not be advertised
    // as a completed minimax iteration or contaminate its score/PV.
    for(int mp:{1,3}) {
        AdvancedOptions interrupted;set_advanced_preset(interrupted,"exact");
        interrupted.multipv=mp;interrupted.limits.depth=3;
        interrupted.limits.iterative=true;interrupted.limits.max_nodes=2;
        auto r=advanced_search(start,interrupted);
        require(!r.base.has_result&&r.base.pv.empty()&&r.base.iterations.empty(),"partial root is not a completed result");
        require(r.completed_root_moves==1&&r.fallback_source=="completed_root_child"&&r.fallback_pv.size()==1,"reuse only a completed child");
        auto legal=start.legal_moves();
        require(std::find(legal.begin(),legal.end(),r.fallback_pv.front())!=legal.end(),"partial fallback is legal");
        require(start.pos.sfen()==SFEN_HIRATE&&start.history.size()==1&&r.base.nodes==2,"partial fallback preserves board and budget");
        interrupted.limits.max_nodes=1;r=advanced_search(start,interrupted);
        require(r.completed_root_moves==0&&r.fallback_source=="first_legal"&&r.fallback_pv.front()==legal.front(),"immediate interruption has a legal fallback");
        interrupted.limits.depth=1;interrupted.limits.max_nodes=10000;r=advanced_search(start,interrupted);
        require(r.base.complete&&r.fallback_pv.empty()&&r.fallback_source.empty(),"completed iteration takes priority");
    }
    for(const auto& sfen:sfens) {
        Board board(sfen);AdvancedOptions ref;set_advanced_preset(ref,"tactical");
        ref.limits.depth=3;ref.limits.max_nodes=12000;ref.limits.iterative=true;
        ref.compact_ordering=false;ref.direct_qmoves=false;ref.defer_qmoves=false;
        auto expected=advanced_search(board,ref);
        for(int variant=1;variant<16;++variant) {
            auto opt=ref;opt.compact_ordering=variant&1;opt.direct_qmoves=variant&2;opt.defer_qmoves=variant&4;opt.lazy_ordering=variant&8;
            auto actual=advanced_search(board,opt);
            require(actual.base.score==expected.base.score&&actual.base.pv==expected.base.pv&&actual.base.nodes==expected.base.nodes
                &&actual.base.completed_depth==expected.base.completed_depth&&actual.base.stop_reason==expected.base.stop_reason,"exact qsearch/order ablation");
            require(board.pos.sfen()==sfen&&board.history.size()==1,"qsearch ablation restores position");
        }
    }
    for(size_t capacity:{size_t(1),size_t(32),size_t(10000)}) {
        AdvancedOptions o;set_advanced_preset(o,"exact");o.tt_capacity=capacity;o.driver="mtdf";o.limits.depth=3;
        Options ref;ref.depth=3;auto truth=search(start,ref);auto r=advanced_search(start,o);
        require(r.base.complete&&r.base.score==truth.score,"tiny table safely exhausts");
    }
    for(auto& sfen:std::vector<std::string>{sfens[0],sfens[1],sfens[2]}) {
        TreeSession old(sfen);Options ref;ref.depth=2;auto expected=old.analyze(ref);
        Board b(sfen);AdvancedOptions o;set_advanced_preset(o,"exact");o.multipv=5;o.limits.depth=2;
        auto r=advanced_search(b,o);require(r.base.complete&&r.candidates.size()==expected.view.candidates.size(),"multipv completed");
        for(size_t i=0;i<r.candidates.size();++i)require(r.candidates[i].score==expected.view.candidates[i].score&&r.candidates[i].pv[0]==expected.view.candidates[i].move,"top5 tie order exact");
    }
    const std::string cycle="5i4i 5a4a 4i5i 4a5a";
    Board repeat("4k4/9/9/9/9/9/9/9/4K4 b - 1");repeat.play_input(cycle+" "+cycle+" "+cycle);
    Board perpetual("4k4/9/5R3/9/9/9/9/9/K8 b - 1");const std::string c="4c5c 5a4a 5c4c 4a5a";perpetual.play_input(c+" "+c+" "+c);
    AdvancedOptions o;set_advanced_preset(o,"selective");o.limits.depth=4;
    require(advanced_search(repeat,o).base.score==0,"fourfold draw");require(advanced_search(perpetual,o).base.score==-mate,"perpetual checker loses");
    for(uint64_t n:{uint64_t(1),uint64_t(31),uint64_t(70),uint64_t(1000)}) {
        o.limits.max_nodes=n;o.limits.iterative=true;
        auto before=start.pos.sfen();auto r=advanced_search(start,o);
        require(!r.base.complete&&r.base.nodes==n,"shared node budget");require(start.pos.sfen()==before&&start.history.size()==1,"abort restores board and history");
    }
    o.limits.max_nodes=2000000;o.limits.time_ms=30;double clock=0;o.limits.clock_ms=[&](){return clock++;};
    require(advanced_search(start,o).base.stop_reason=="time_limit","deterministic time budget");
    o.limits.clock_ms={};o.limits.time_ms=0;o.limits.stop_requested=[](){return true;};
    require(advanced_search(start,o).base.stop_reason=="external_stop","USI stop");
    // Qsearch must include all check evasions even at a zero quiet budget.
    Board checked("4k4/9/9/9/9/4r4/9/9/4K4 b G 1");AdvancedOptions q;set_advanced_preset(q,"tactical");q.qdepth=0;q.limits.depth=0;
    auto qr=advanced_search(checked,q);require(qr.base.complete&&!qr.base.pv.empty(),"qsearch cannot stand pat in check");
    Board matepos(sfens[3]);require(advanced_search(matepos,q).base.score==-mate,"qsearch terminal mate");
    Board stalemate("k6r1/9/9/9/9/9/9/6r2/8K b - 1");
    require(!stalemate.pos.in_check()&&advanced_search(stalemate,q).base.score==-mate,"no-legal-move detected before stand pat");
    Board drop_only("k6r1/9/9/9/9/9/9/6r2/8K b P 1");
    require(!drop_only.has_legal_king_move()&&advanced_search(drop_only,q).base.score>-90000,"failed king witness is not terminal proof");
    for(auto& sfen:std::vector<std::string>{sfens[0],sfens[1],sfens[2]}) {
        Board b(sfen);AdvancedOptions qo;set_advanced_preset(qo,"tactical");qo.qdepth=2;qo.limits.depth=2;qo.driver="ab";
        const auto reference=advanced_search(b,qo);qo.driver="pvs";const auto pvs=advanced_search(b,qo);
        require(reference.base.complete&&pvs.base.complete&&reference.base.score==pvs.base.score,"PVS preserves identical qsearch leaf policy");
    }
    // Every exposed heuristic is executed in a bounded real search and unwinds.
    for(auto f:advanced_features()) {
        if(f=="probcut"||f=="multiprobcut")continue;
        AdvancedOptions h;set_advanced_preset(h,"tactical");h.features.insert(f);h.limits.depth=5;h.limits.max_nodes=3000;
        auto r=advanced_search(start,h);require(r.base.nodes<=3000&&start.history.size()==1&&start.pos.sfen()==SFEN_HIRATE,"heuristic budget and restoration "+f);
    }
    for(auto driver:{"rps","erps"}){AdvancedOptions p;p.features={"qsearch"};p.driver=driver;p.limits.depth=4;p.limits.max_nodes=3000;auto r=advanced_search(start,p);require(r.base.nodes<=3000&&start.history.size()==1,std::string("probability search ")+driver);}
    for(uint64_t n:{uint64_t(1),uint64_t(31),uint64_t(1000),uint64_t(10000)}) {
        AdvancedOptions a;set_advanced_preset(a,"tactical");a.driver="adaptive";a.limits.max_nodes=n;
        auto r=advanced_search(start,a);
        require(r.base.nodes==n&&r.base.stop_reason=="node_limit","adaptive bounded by nodes not target depth");
        require(start.pos.sfen()==SFEN_HIRATE&&start.history.size()==1,"adaptive abort restores board");
        auto pv=r.base.has_result?r.base.pv:r.fallback_pv;
        require(!pv.empty(),"adaptive legal emergency/completed move");
        Board replay;for(auto m:pv){auto legal=replay.legal_moves();require(std::find(legal.begin(),legal.end(),m)!=legal.end(),"adaptive PV legal");replay.play_input(usi(m));}
    }
    {
        AdvancedOptions a;set_advanced_preset(a,"tactical");a.driver="adaptive";
        require(advanced_search(repeat,a).base.score==0,"adaptive respects repetition history");
        require(advanced_search(perpetual,a).base.score==-mate,"adaptive perpetual check");
        require(advanced_search(matepos,a).base.score==-mate,"adaptive terminal mate");
        double t=0;a.limits.clock_ms=[&](){return t++;};a.limits.time_ms=20;
        require(advanced_search(start,a).base.stop_reason=="time_limit","adaptive time deadline");
    }
    std::cout<<"{\"advanced_selftest\":\"passed\",\"checks\":"<<checks<<",\"move_positions\":"<<move_positions<<",\"moves_compared\":"<<move_count<<",\"random_seed\":20260921}\n";return 0;
}
}
