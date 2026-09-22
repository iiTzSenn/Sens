export interface Shape {
  size: number;
}

type Handler = (s: Shape) => void;

export const handler: Handler = (s) => {
  console.log(s.size);
};
