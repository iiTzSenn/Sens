// This sub-package's `main` (dist/api.js) resolves here, so fooApi is public API
// and must not be flagged — even though nothing in the monorepo imports it.
export function fooApi(): number {
  return 1;
}

// Internal, never used -> a dead-code candidate.
function fooHelper(): number {
  return 2;
}
