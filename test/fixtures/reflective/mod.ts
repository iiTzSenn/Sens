export function reflectiveHandler(): void {
  console.log("called by name from config");
}

function internalHook(): void {
  console.log("wired by name");
}
