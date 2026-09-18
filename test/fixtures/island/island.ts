export function entry(): void {
  liveHelper();
}

function liveHelper(): void {
  console.log("reached from entry");
}

function islandA(): void {
  islandB();
}

function islandB(): void {
  islandA();
}

export function deadExport(): void {
  privateOfDeadExport();
}

function privateOfDeadExport(): void {
  console.log("only reached from an export");
}

entry();
