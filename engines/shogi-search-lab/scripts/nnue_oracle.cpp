// Test harness: upstream feature transformer and network, with no lab inference.
#include "position.h"
#include "eval/nnue/nnue_feature_transformer.h"
#include <algorithm>
#include <fstream>
#include <iostream>
int main(int argc,char** argv) {
    if(argc!=2)return 2;
    using namespace Eval::NNUE;
    static FeatureTransformer transformer;
    static Network network;
    std::ifstream in(argv[1],std::ios::binary);uint32_t version,hash,length;
    in.read((char*)&version,4);in.read((char*)&hash,4);in.read((char*)&length,4);
    if(!in||length>1024)return 2;
    in.ignore(length);in.read((char*)&hash,4);
    if(hash!=FeatureTransformer::GetHashValue()||!transformer.ReadParameters(in))return 2;
    in.read((char*)&hash,4);if(hash!=Network::GetHashValue()||!network.ReadParameters(in)||in.peek()!=EOF)return 2;
    Bitboards::init();Position::init();
    std::string sfen;
    while(std::getline(std::cin,sfen)) {
        Position pos;StateInfo state;pos.set(sfen,&state,nullptr);
        alignas(kCacheLineSize) TransformedFeatureType x[FeatureTransformer::kBufferSize];
        alignas(kCacheLineSize) char buffer[Network::kBufferSize];
        transformer.Transform(pos,x,true);
        std::cout<<std::clamp(int(network.Propagate(x,buffer)[0])/FV_SCALE,-27000,27000)<<std::endl;
    }
}
