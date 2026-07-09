// This file is the package's `main` (built to dist/api.js), so its exports are
// public API and must not be flagged as dead — even though nothing imports them
// inside the project.
export function publicThing(): number {
  return 1;
}

// Internal, never used -> still a dead-code candidate.
function privateThing(): number {
  return 2;
}
