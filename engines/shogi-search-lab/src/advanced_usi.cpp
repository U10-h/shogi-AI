#include "advanced.hpp"
#include <atomic>
#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <thread>

namespace lab {
int advanced_usi(const AdvancedOptions& defaults) {
    AdvancedOptions configured=defaults;
    configured.limits.iterative=true;
    auto board=std::make_unique<Board>();
    std::atomic<bool> stopped{false};std::thread worker;std::mutex output, stop_mutex;
    std::condition_variable stop_condition;
    auto send=[&](const std::string& s){std::lock_guard<std::mutex> lock(output);std::cout<<s<<std::endl;};
    auto join=[&](){{std::lock_guard<std::mutex> lock(stop_mutex);stopped=true;}stop_condition.notify_all();if(worker.joinable())worker.join();};
    std::string line;
    while(std::getline(std::cin,line)) {
        std::istringstream in(line);std::string command;in>>command;
        try {
            if(command=="usi") {
                std::string preset="custom";
                for(const char* name:{"baseline","exact","tactical","selective"}) {
                    AdvancedOptions candidate;set_advanced_preset(candidate,name);
                    if(candidate.driver==configured.driver&&candidate.features==configured.features)preset=name;
                }
                send("id name Shogi Search Lab v0.5\nid author Shogi Search Lab\noption name Preset type combo default "+preset+" var baseline var exact var tactical var selective var custom\noption name MultiPV type spin default "+std::to_string(configured.multipv)+" min 1 max 5\noption name USI_Ponder type check default false\nusiok");
            }
            else if(command=="isready")send("readyok");
            else if(command=="quit"){join();break;}
            else if(command=="stop")join();
            else if(command=="gameover")join();
            else if(command=="usinewgame"){join();board=std::make_unique<Board>();}
            else if(command=="setoption") {
                join();std::string name,key,value;in>>key>>name>>key>>value;
                if(name=="Preset") {
                    if(value=="custom"){configured.features=defaults.features;configured.driver=defaults.driver;}
                    else set_advanced_preset(configured,value);
                }
                else if(name=="MultiPV"){int n=std::stoi(value);if(n<1||n>5)throw std::invalid_argument("Invalid MultiPV");configured.multipv=n;}
                else if(name=="USI_Ponder") {if(value!="false")send("info string ponder is not supported; disable USI_Ponder");}
                else if(name=="USI_Hash")send("info string fixed entry cap; use --tt-entries for memory control");
                else throw std::invalid_argument("Unknown USI option");
            }else if(command=="position") {
                join();std::string kind,sfen=SFEN_HIRATE,token,moves;in>>kind;
                if(kind=="sfen"){std::string a,b,c,d;if(!(in>>a>>b>>c>>d))throw std::invalid_argument("Incomplete SFEN");sfen=a+" "+b+" "+c+" "+d;}
                else if(kind!="startpos")throw std::invalid_argument("Expected startpos or sfen");
                if(in>>token){if(token!="moves")throw std::invalid_argument("Expected moves");std::getline(in,moves);}
                auto next=std::make_unique<Board>(sfen);next->play_input(moves);board=std::move(next);
            }else if(command=="go") {
                join();AdvancedOptions options=configured;options.limits.depth=16;
                options.limits.max_nodes=1000000000;options.limits.time_ms=3000;
                uint64_t byo=0,bt=0,wt=0,inc=0;bool explicit_time=false,depth_only=false,infinite=false,mate_request=false;std::string word;
                while(in>>word) {
                    if(word=="mate"){mate_request=true;break;}
                    if(word=="infinite"){options.limits.time_ms=3600000;explicit_time=true;infinite=true;continue;}
                    if(word=="ponder")throw std::invalid_argument("Ponder is not supported");
                    uint64_t n;if(!(in>>n)||n>1000000000)throw std::invalid_argument("Invalid go limit");
                    if(word=="depth"){if(n<1||n>16)throw std::invalid_argument("Depth must be 1..16");options.limits.depth=int(n);depth_only=true;}
                    else if(word=="nodes")options.limits.max_nodes=n;
                    else if(word=="movetime"){options.limits.time_ms=std::min<uint64_t>(3600000,std::max<uint64_t>(1,n));explicit_time=true;}
                    else if(word=="byoyomi")byo=n;
                    else if(word=="btime")bt=n;
                    else if(word=="wtime")wt=n;
                    else if(word==(board->pos.side_to_move()==BLACK?"binc":"winc"))inc=n;
                    else if(word!="binc"&&word!="winc")throw std::invalid_argument("Unsupported go token");
                }
                if(mate_request){send("checkmate notimplemented");continue;}
                if(!explicit_time) {
                    if(byo||bt||wt||inc)options.limits.time_ms=std::min<uint64_t>(3600000,std::max<uint64_t>(1,byo+inc+(board->pos.side_to_move()==BLACK?bt:wt)/30));
                    else if(depth_only)options.limits.time_ms=0;
                }
                stopped=false;options.limits.stop_requested=[&](){return stopped.load();};
                worker=std::thread([&,options,infinite](){
                    try {
                        auto r=advanced_search(*board,options);
                        auto info_line=[&](int score,const std::vector<Move>& pv,int rank){
                            std::ostringstream info;info<<"info depth "<<std::max(0,r.base.completed_depth)<<" nodes "<<r.base.nodes<<" time "<<int(r.base.elapsed_ms);
                            if(options.multipv>1)info<<" multipv "<<rank;
                            if(std::abs(score)>90000&&!board->repetition_score(0)) {
                                info<<" score mate ";
                                int distance=mate-std::abs(score);
                                if(distance==0)info<<(score>0?"+":"-");else info<<(score>0?distance:-distance);
                            }else info<<" score cp "<<score;
                            info<<" pv";for(Move m:pv)info<<' '<<usi(m);send(info.str());
                        };
                        if(r.base.has_result) {
                            if(r.candidates.empty())info_line(r.base.score,r.base.pv,1);
                            else for(size_t i=0;i<r.candidates.size();++i)info_line(r.candidates[i].score,r.candidates[i].pv,int(i+1));
                        }
                        // USI infinite analysis must not emit bestmove before stop,
                        // even when a terminal position or resource cap ends search.
                        if(infinite){std::unique_lock<std::mutex> lock(stop_mutex);stop_condition.wait(lock,[&](){return stopped.load();});}
                        std::string move="resign";
                        if(!r.base.pv.empty())move=usi(r.base.pv[0]);
                        else if(!board->repetition_score(0)){auto legal=board->legal_moves();if(!legal.empty()){move=usi(legal[0]);send("info string no completed iteration; legal fallback");}}
                        send("bestmove "+move);
                    }catch(const std::exception& e){send("info string error "+std::string(e.what()));send("bestmove resign");}
                });
            }
        }catch(const std::exception& e){send("info string error "+std::string(e.what()));}
    }
    join();return 0;
}
}
