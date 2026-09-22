#include "util.hpp"

static int staticUnused(int x) { return x * 2; }

namespace {

int anonUnused(int x) { return x + 1; }
}

int usedHelper(int x) { return x + 100; }

int publicUnused(int x) { return x - 1; }
