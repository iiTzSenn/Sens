// Nobody imports this module and none of its symbols is reachable -> the whole
// file is dead. A per-symbol view would list each function; the file-level view
// says "just delete orphan.ts".
function unusedThing(): void {
  console.log("unused");
}

function alsoUnused(): void {
  unusedThing();
}
