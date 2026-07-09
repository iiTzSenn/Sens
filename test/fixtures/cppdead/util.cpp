#include "util.hpp"

// Internal linkage (static) and never called -> genuinely dead (HIGH).
static int staticUnused(int x) { return x * 2; }

namespace {
// Anonymous-namespace member, never called -> genuinely dead (HIGH).
int anonUnused(int x) { return x + 1; }
}  // namespace

int usedHelper(int x) { return x + 100; }

int publicUnused(int x) { return x - 1; }
