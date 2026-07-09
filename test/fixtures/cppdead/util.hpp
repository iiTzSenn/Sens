#pragma once

// Defined in util.cpp, used from main.cpp — a cross-TU use that must stay alive.
int usedHelper(int x);

// Public API, never referenced in-project. Externally linkable, so at most LOW.
int publicUnused(int x);

// A used template function. Instantiations don't appear as ordinary calls and
// templates aren't emitted as call-graph symbols, so this must never be flagged.
template <typename T>
T maxOf(T a, T b) { return a > b ? a : b; }
