#include "a.h"

static int static_used(int x) {
  return x + 1;
}

static int static_unused(int x) {
  return x - 1;
}

void used_func(void) {
  static_used(41);
}

void orphan_func(void) {

}
