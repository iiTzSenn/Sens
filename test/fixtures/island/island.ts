// Reachable chain: entry() is called at module scope, so it is a root, and
// liveHelper() is reached from it.
export function entry(): void {
  liveHelper();
}

function liveHelper(): void {
  console.log("reached from entry");
}

// Dead island: islandA and islandB reference each other but nothing outside the
// pair ever reaches them. Each HAS a reference (from the other), so a plain
// "zero references" detector misses them; reachability catches the whole cluster.
function islandA(): void {
  islandB();
}

function islandB(): void {
  islandA();
}

// An unused export. It might still be called from outside the index, so its
// private helper is SPARED (not flagged) even though only deadExport reaches it.
export function deadExport(): void {
  privateOfDeadExport();
}

function privateOfDeadExport(): void {
  console.log("only reached from an export");
}

entry();
