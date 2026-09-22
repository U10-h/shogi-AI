CXX ?= g++
CPPFLAGS := -Ivendor/yaneuraou -DLAB_RULES_ONLY -DUSE_GENERATE_ALL_LEGAL_MOVES -DNO_SSE -DASSERT_LV=1
CXXFLAGS ?= -std=c++17 -O2 -g -Wall -Wextra -Wno-unused-parameter -Wno-unused-function -Wno-unused-but-set-variable -ffunction-sections -fdata-sections
LDFLAGS := -Wl,--gc-sections -pthread
RULES := bitboard.cpp position.cpp movegen.cpp types.cpp eval/evaluate.cpp
SOURCES := src/main.cpp src/board.cpp src/evaluate.cpp src/search.cpp src/tests.cpp src/session.cpp src/session_cli.cpp src/session_tests.cpp src/advanced.cpp src/advanced_tests.cpp src/advanced_usi.cpp $(addprefix vendor/yaneuraou/,$(RULES))
OBJECTS := $(patsubst %.cpp,build/%.o,$(SOURCES))
.PHONY: all clean test
all: build/shogi-lab
build/shogi-lab: $(OBJECTS)
	$(CXX) $^ $(LDFLAGS) -o $@
build/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -MMD -MP -c $< -o $@
-include $(OBJECTS:.o=.d)
test: build/shogi-lab
	./build/shogi-lab --selftest
	./build/shogi-lab --session-selftest
	./build/shogi-lab --advanced-selftest
clean:
	rm -rf build
