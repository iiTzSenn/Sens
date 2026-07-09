#include "a.h"

/* static + used within this file -> alive (never flagged). */
static int static_used(int x) {
  return x + 1;
}

/* static + never called anywhere -> internal dead -> HIGH. */
static int static_unused(int x) {
  return x - 1;
}

/* non-static, called from main.c via the header -> alive. */
void used_func(void) {
  static_used(41);
}

/* non-static, never called -> externally linkable -> LOW (verify API). */
void orphan_func(void) {
  /* nothing calls this */
}
