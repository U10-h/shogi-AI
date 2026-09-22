// K+P feature numbering and integer inference follow YaneuraOu 6.03.
// See THIRD_PARTY.md and vendor/yaneuraou/eval/nnue/. GPL-3.0.
#include "nnue.hpp"
#include <algorithm>
#include <stdexcept>
#if (defined(__x86_64__) || defined(__i386__)) && (defined(__GNUC__) || defined(__clang__))
#include <immintrin.h>
#define LAB_AVX2_DISPATCH 1
#endif

namespace lab {
namespace {
constexpr int width=256, inputs=1710;
using Acc=std::array<std::array<int16_t,width>,2>;
int feature(Piece pc,int sq,int perspective) {
    const int categories[15]={0,0,1,2,3,5,7,4,0,4,4,4,4,6,8};
    int oriented=perspective==BLACK?sq:80-sq;
    int enemy=int(color_of(pc))!=perspective?81:0;
    return (type_of(pc)==KING?1548:90+162*categories[int(type_of(pc))])+enemy+oriented;
}
int hand_feature(int pt,int color,int perspective,int index) {
    const int bases[8][2]={{0,0},{1,20},{39,44},{49,54},{59,64},{79,82},{85,88},{69,74}};
    return bases[pt][color!=perspective]+index;
}
int missing(const Snapshot& s) {
    int count=0;
    for(auto p:s.squares)if(p&&type_of(Piece(p))!=KING)++count;
    for(int c=0;c<2;++c)for(int p=1;p<=7;++p)count+=hand_count(s.hands[c],PieceType(p));
    return 38-count;
}
struct Reader {
    std::ifstream in;
    explicit Reader(const std::string& path):in(path,std::ios::binary) {
        if(!in)throw std::invalid_argument("Cannot open NNUE model: "+path);
    }
    uint32_t integer(int bytes) {
        uint32_t n=0;
        for(int j=0;j<bytes;++j){int c=in.get();if(c==EOF)throw std::invalid_argument("Truncated NNUE model");n|=uint32_t(c)<<(j*8);}
        return n;
    }
    template<class T> void values(T& a,int bytes) {
        for(auto& v:a){uint32_t n=integer(bytes);int64_t s=n;
            if(n&(uint32_t(1)<<(bytes*8-1)))s-=int64_t(1)<<(bytes*8);
            v=static_cast<typename T::value_type>(s);
        }
    }
    void expect(uint32_t value){if(integer(4)!=value)throw std::invalid_argument("Unsupported NNUE format/hash");}
};
int16_t wrap16(int n) {
    const auto bits=static_cast<uint16_t>(n);
    return static_cast<int16_t>(bits<32768?int(bits):int(bits)-65536);
}
template<size_t N,size_t M> std::array<uint8_t,M> hidden_scalar(
    const std::array<uint8_t,N>& x,const std::array<int32_t,M>& bias,const std::array<int8_t,N*M>& weights) {
    std::array<uint8_t,M> out{};
    for(size_t j=0;j<M;++j){int32_t sum=bias[j];for(size_t i=0;i<N;++i)sum+=x[i]*int(weights[j*N+i]);
        out[j]=uint8_t(sum<=0?0:std::min(127,sum/64));}
    return out;
}
bool has_avx2() {
#ifdef LAB_AVX2_DISPATCH
    return __builtin_cpu_supports("avx2");
#else
    return false;
#endif
}
#ifdef LAB_AVX2_DISPATCH
// x is in [0,127], w in [-128,127]. Each adjacent pair is in
// [-32512,32258], so maddubs' signed saturation never changes the result.
// Sum in 32 bits before adding the validated bias. No global -march flag.
template<size_t N,size_t M> __attribute__((target("avx2")))
std::array<uint8_t,M> hidden_avx2(const std::array<uint8_t,N>& x,
    const std::array<int32_t,M>& bias,const std::array<int8_t,N*M>& weights) {
    static_assert(N%32==0,"AVX2 affine inputs must be a multiple of 32");
    std::array<uint8_t,M> out{};
    const __m256i ones=_mm256_set1_epi16(1);
    for(size_t j=0;j<M;++j) {
        __m256i sum=_mm256_setzero_si256();
        for(size_t i=0;i<N;i+=32) {
            const auto a=_mm256_loadu_si256(reinterpret_cast<const __m256i*>(x.data()+i));
            const auto w=_mm256_loadu_si256(reinterpret_cast<const __m256i*>(weights.data()+j*N+i));
            sum=_mm256_add_epi32(sum,_mm256_madd_epi16(_mm256_maddubs_epi16(a,w),ones));
        }
        __m128i s=_mm_add_epi32(_mm256_castsi256_si128(sum),_mm256_extracti128_si256(sum,1));
        s=_mm_add_epi32(s,_mm_srli_si128(s,8));s=_mm_add_epi32(s,_mm_srli_si128(s,4));
        const int32_t v=bias[j]+_mm_cvtsi128_si32(s);
        out[j]=uint8_t(v<=0?0:std::min(127,v/64));
    }
    return out;
}
__attribute__((target("avx2"))) void add_avx2(int16_t* a,const int16_t* w,int amount) {
    const auto factor=_mm256_set1_epi16(int16_t(amount));
    for(int j=0;j<width;j+=16) {
        const auto x=_mm256_loadu_si256(reinterpret_cast<const __m256i*>(a+j));
        const auto y=_mm256_loadu_si256(reinterpret_cast<const __m256i*>(w+j));
        _mm256_storeu_si256(reinterpret_cast<__m256i*>(a+j),_mm256_add_epi16(x,_mm256_mullo_epi16(y,factor)));
    }
}
__attribute__((target("avx2"))) void deltas_avx2(int16_t* a,const std::vector<const int16_t*>& columns,const std::vector<int>& amounts) {
    for(int j=0;j<width;j+=16) {
        auto v=_mm256_loadu_si256(reinterpret_cast<const __m256i*>(a+j));
        for(size_t i=0;i<columns.size();++i) {
            auto w=_mm256_loadu_si256(reinterpret_cast<const __m256i*>(columns[i]+j));
            v=_mm256_add_epi16(v,_mm256_mullo_epi16(w,_mm256_set1_epi16(int16_t(amounts[i]))));
        }
        _mm256_storeu_si256(reinterpret_cast<__m256i*>(a+j),v);
    }
}
#endif
template<size_t N,size_t M> std::array<uint8_t,M> hidden(
    const std::array<uint8_t,N>& x,const std::array<int32_t,M>& bias,
    const std::array<int8_t,N*M>& weights,bool vectorized,bool verify) {
#ifdef LAB_AVX2_DISPATCH
    if(vectorized) {
        auto out=hidden_avx2<N,M>(x,bias,weights);
        if(verify&&out!=hidden_scalar<N,M>(x,bias,weights))throw std::logic_error("NNUE SIMD affine mismatch");
        return out;
    }
#endif
    return hidden_scalar<N,M>(x,bias,weights);
}
}
struct Nnue::Impl {
    std::array<int16_t,width> bias;
    std::vector<int16_t> weights;
    std::array<int32_t,32> b1,b2;
    std::array<int8_t,512*32> w1;
    std::array<int8_t,32*32> w2;
    std::array<int32_t,1> b3;
    std::array<int8_t,32> w3;
    bool residual=false,clipped=false;
    std::array<int32_t,32> rb2{};
    std::array<int8_t,1024> rw2{};
    std::array<int8_t,32> rw3{};
    int32_t rb3=0;
    void load_head(const std::string& path,bool cap) {
        std::ifstream in(path);std::string header;
        if(!std::getline(in,header)||header!="shogi-lab-residual-v1 raw90 dim32")throw std::invalid_argument("Invalid residual head");
        auto read=[&](auto& array,int64_t lo,int64_t hi){for(auto& v:array){int64_t n;if(!(in>>n)||n<lo||n>hi)throw std::invalid_argument("Invalid residual coefficient");v=n;}};
        read(rb2,-1000000000,1000000000);read(rw2,-128,127);
        std::array<int32_t,1> last{};read(last,-1000000000,1000000000);rb3=last[0];read(rw3,-128,127);
        std::string extra;if(in>>extra)throw std::invalid_argument("Trailing residual data");
        residual=true;clipped=cap;frames.clear();for(auto& x:score_cache)x.valid=false;
    }
    struct Frame {bool valid=false;Snapshot snapshot{};Acc acc{};int score=0;};
    std::vector<Frame> frames;
    // K+P has no king-conditioned refresh buckets. This is an exact static-score
    // cache, not a search-value TT and not a literal HalfKP Finny-table port.
    struct ScoreEntry {bool valid=false;Snapshot snapshot{};int score=0;};
    std::vector<ScoreEntry> score_cache;
    bool fused=false,cache=false,verify_fast=false;
    std::string policy;
    bool vectorized=false;
    std::map<std::string,uint64_t> counts;
    Impl(const std::string& path,const std::string& mode):weights(inputs*width),policy(mode) {
        vectorized=mode!="nnue-scalar"&&has_avx2();
        fused=mode=="nnue-fused"||mode=="nnue-fast"||mode=="nnue-fast-verify";
        cache=mode=="nnue-cache"||mode=="nnue-fast"||mode=="nnue-fast-verify";
        verify_fast=mode=="nnue-fast-verify";
        if(cache)score_cache.resize(16384);
        counts["nnue_avx2_enabled"]=vectorized;
        Reader r(path);r.expect(0x7af32f16);r.expect(0x5c6464a9);
        const std::string architecture="Features=K+P[1710->256x2],Network=AffineTransform[1<-32](ClippedReLU[32](AffineTransform[32<-32](ClippedReLU[32](AffineTransform[32<-512](InputSlice[512(0:512)])))))";
        r.expect(uint32_t(architecture.size()));
        for(char c:architecture)if(r.integer(1)!=uint8_t(c))throw std::invalid_argument("Unsupported NNUE architecture");
        r.expect(0x3f5715ff);r.values(bias,2);r.values(weights,2);
        r.expect(0x63337156);r.values(b1,4);r.values(w1,1);r.values(b2,4);r.values(w2,1);r.values(b3,4);r.values(w3,1);
        if(r.in.peek()!=EOF)throw std::invalid_argument("Unexpected NNUE model data");
        // Bound accumulations in affine layers for every accepted model.
        for(auto* b:{&b1,&b2})for(auto v:*b)if(v>1000000000||v< -1000000000)throw std::invalid_argument("NNUE bias out of range");
        if(b3[0]>1000000000||b3[0]< -1000000000)throw std::invalid_argument("NNUE bias out of range");
    }
    void add(Acc& a,int perspective,int index,int amount) const {
        const auto* column=&weights[index*width];
#ifdef LAB_AVX2_DISPATCH
        if(vectorized){add_avx2(a[perspective].data(),column,amount);return;}
#endif
        for(int j=0;j<width;++j)a[perspective][j]=wrap16(int(a[perspective][j])+amount*int(column[j]));
    }
    Acc refresh(const Snapshot& s) const {
        Acc a{bias,bias};
        for(int c=0;c<2;++c){
            for(int sq=0;sq<81;++sq)if(s.squares[sq])add(a,c,feature(Piece(s.squares[sq]),sq,c),1);
            for(int side=0;side<2;++side)for(int pt=1;pt<=7;++pt)
                for(int i=0;i<hand_count(s.hands[side],PieceType(pt));++i)add(a,c,hand_feature(pt,side,c,i),1);
            add(a,c,0,missing(s));
        }
        return a;
    }
    Acc update(const Frame& from,const Snapshot& to) const {
        Acc a=from.acc;const auto& old=from.snapshot;
        int zero=0;
        std::array<std::vector<const int16_t*>,2> columns;
        std::array<std::vector<int>,2> amounts;
        auto delta=[&](int c,int idx,int amount){
            if(fused&&vectorized){columns[c].push_back(&weights[idx*width]);amounts[c].push_back(amount);}
            else add(a,c,idx,amount);
        };
        for(int sq=0;sq<81;++sq)if(old.squares[sq]!=to.squares[sq]) {
            zero+=(old.squares[sq]&&type_of(Piece(old.squares[sq]))!=KING)
                 -(to.squares[sq]&&type_of(Piece(to.squares[sq]))!=KING);
            for(int c=0;c<2;++c){
                if(old.squares[sq])delta(c,feature(Piece(old.squares[sq]),sq,c),-1);
                if(to.squares[sq])delta(c,feature(Piece(to.squares[sq]),sq,c),1);
            }
        }
        for(int side=0;side<2;++side)for(int pt=1;pt<=7;++pt){
            int before=hand_count(old.hands[side],PieceType(pt)),after=hand_count(to.hands[side],PieceType(pt));
            zero+=before-after;
            for(int i=std::min(before,after);i<std::max(before,after);++i)
                for(int c=0;c<2;++c)delta(c,hand_feature(pt,side,c,i),after>before?1:-1);
        }
        if(zero)for(int c=0;c<2;++c)delta(c,0,zero);
#ifdef LAB_AVX2_DISPATCH
        if(fused&&vectorized)for(int c=0;c<2;++c)deltas_avx2(a[c].data(),columns[c],amounts[c]);
#endif
        return a;
    }
    int score(const Acc& a,Color side) const {
        std::array<uint8_t,512> x;
        for(int c=0;c<2;++c)for(int j=0;j<width;++j)x[c*width+j]=uint8_t(std::clamp(int(a[int(side)^c][j]),0,127));
        const auto h1=hidden<512,32>(x,b1,w1,vectorized,policy=="nnue-verify"),
                   h2=hidden<32,32>(h1,b2,w2,vectorized,policy=="nnue-verify");
        int32_t out=b3[0];for(int i=0;i<32;++i)out+=int(h2[i])*w3[i];
        // Preserve the upstream raw unit (PawnValue=90), including truncation.
        const int base=std::clamp(out/16,-27000,27000);
        if(!residual)return base;
        const auto rh=hidden<32,32>(h1,rb2,rw2,vectorized,false);
        int32_t raw=rb3;for(int i=0;i<32;++i)raw+=int(rh[i])*rw3[i];
        int delta=(std::clamp(raw/16,-27000,27000)-base)/4;
        if(clipped)delta=std::clamp(delta,-72,72);
        return std::clamp(base+delta,-27000,27000);
    }
    std::array<uint8_t,32> first_hidden(const Board& b) const {
        const auto& s=b.history.back();const Acc a=refresh(s);
        std::array<uint8_t,512> x;
        for(int c=0;c<2;++c)for(int j=0;j<width;++j)x[c*width+j]=uint8_t(std::clamp(int(a[int(s.side)^c][j]),0,127));
        return hidden<512,32>(x,b1,w1,vectorized,policy=="nnue-verify");
    }
    int evaluate(const Board& b) {
        ++counts["nnue_calls"];const auto& s=b.history.back();
        ScoreEntry* cached=nullptr;
        if(cache) {
            cached=&score_cache[(uint64_t(s.key)^(uint64_t(s.key)>>32))&(score_cache.size()-1)];
            if(cached->valid&&cached->snapshot.same_position(s)) {
                ++counts["nnue_position_hits"];
                if(verify_fast&&cached->score!=score(refresh(s),s.side))throw std::logic_error("NNUE static cache mismatch");
                return cached->score;
            }
            ++counts["nnue_position_misses"];
        }
        if(policy=="nnue-full"){++counts["nnue_refreshes"];return score(refresh(s),s.side);}
        const size_t ply=b.history.size()-1;
        if(frames.size()<=ply)frames.resize(ply+1);
        auto& f=frames[ply];
        if(f.valid&&f.snapshot.same_position(s)){++counts["nnue_cache_hits"];return f.score;}
        // Any known accumulator is a valid base for an exact board/hand delta.
        // Prefer a parent, then the previous sibling; no search bound is reused.
        const Frame* base=ply&&frames[ply-1].valid?&frames[ply-1]:f.valid?&f:nullptr;
        Acc a;
        if(base){a=update(*base,s);++counts["nnue_updates"];}
        else {a=refresh(s);++counts["nnue_refreshes"];}
        if(policy=="nnue-verify"||verify_fast){
            ++counts["nnue_verified"];if(a!=refresh(s))throw std::logic_error("NNUE incremental accumulator mismatch");
        }
        f.acc=a;f.snapshot=s;f.score=score(a,s.side);f.valid=true;if(cached)*cached={true,s,f.score};return f.score;
    }
};
Nnue::Nnue(const std::string& path,const std::string& policy):impl(std::make_shared<Impl>(path,policy)){}
void Nnue::residual_head(const std::string& path,bool clipped){impl->load_head(path,clipped);}
int Nnue::operator()(const Board& b) const{return impl->evaluate(b);}
std::array<uint8_t,32> Nnue::first_hidden(const Board& b) const{return impl->first_hidden(b);}
std::map<std::string,uint64_t> Nnue::stats() const{return impl->counts;}
}
