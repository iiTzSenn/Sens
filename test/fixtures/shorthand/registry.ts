const alpha = (): number => 1;
const beta = (): number => 2;

// alpha and beta are only referenced via object shorthand.
export const registry = { alpha, beta };
