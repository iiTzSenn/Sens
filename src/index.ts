// Public library API for Sens.
// Populated as milestones land (indexer, store, query engine).

// Replaced at build time (tsup `define`) with the real package.json version.
// The guard keeps it working when run un-bundled (e.g. tests, tsx).
declare const __SENS_VERSION__: string;
export const VERSION =
  typeof __SENS_VERSION__ !== "undefined" ? __SENS_VERSION__ : "0.0.0";
