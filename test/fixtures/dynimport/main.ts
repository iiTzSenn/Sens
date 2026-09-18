export async function boot() {
  const { lazyThing } = await import("./mod.js");
  return lazyThing();
}

export const REGISTRY = ["registered"];
