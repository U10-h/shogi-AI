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
    std::cout<<"{\"advanced_selftest\":\"passed\",\"checks\":"<<checks<<",\"random_seed\":20260921}\n";return 0;
}
}
