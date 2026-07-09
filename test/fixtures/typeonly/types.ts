// Shape is used ONLY in a type position (a parameter annotation), never as a
// value. A resolver that only counts value references would wrongly flag it.
export interface Shape {
  size: number;
}

type Handler = (s: Shape) => void;

export const handler: Handler = (s) => {
  console.log(s.size);
};
