// Minimal ambient types for qrcode-terminal (ships no types of its own).
declare module "qrcode-terminal" {
  export function generate(
    input: string,
    opts?: { small?: boolean },
    cb?: (qr: string) => void,
  ): void;
  const _default: { generate: typeof generate };
  export default _default;
}
