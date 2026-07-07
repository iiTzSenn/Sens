export async function boot() {
  const { lazyThing } = await import("./mod.js");
  return lazyThing();
}

// reflective access by name (e.g. a registry keyed by string)
export const REGISTRY = ["registered"];
