// Imported only through a path alias ("@/utils"). If the indexer ignores the
// project's tsconfig `paths`, the import won't resolve and this looks dead.
export function aliased(): number {
  return 1;
}
