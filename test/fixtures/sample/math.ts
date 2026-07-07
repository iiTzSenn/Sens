export function add(a: number, b: number): number {
  return a + b;
}

// Exported but never imported anywhere -> dead-code candidate.
export function subtract(a: number, b: number): number {
  return a - b;
}

// Local, never called -> dead-code candidate.
function unusedHelper(): void {
  console.log("never called");
}

export const PI = 3.14159;
