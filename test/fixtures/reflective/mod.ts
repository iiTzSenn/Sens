// Looks dead to the indexer (no source references), but it's wired up by name in
// config.json — the reflective scan should flag that so it isn't deleted.
export function reflectiveHandler(): void {
  console.log("called by name from config");
}

// Internal + unreferenced, so it would be HIGH confidence — but its name appears
// in config.json, so the reflective scan must drop it to LOW.
function internalHook(): void {
  console.log("wired by name");
}
