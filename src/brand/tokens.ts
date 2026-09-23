export const palette = {
  "carbon-950": "#0c0d0d",
  "carbon-900": "#111313",
  "carbon-800": "#1a1d1c",
  "carbon-700": "#252927",
  "carbon-600": "#363b38",
  "alloy-500": "#747b77",
  "alloy-400": "#929995",
  "alloy-300": "#b5bbb7",
  "bone-200": "#dddcd5",
  "bone-100": "#eceae3",
  "bone-50": "#f4f1ea",
  paper: "#fbfaf6",
  "signal-700": "#78aa12",
  "signal-600": "#a9e52d",
  "signal-500": "#c7ff4a",
  "signal-200": "#e4ffa5",
  "signal-100": "#f0ffd0",
  "signal-tint-900": "#1a1f16",
  "signal-tint-700": "#353e2a",
  success: "#43c878",
  warning: "#e7b84b",
  danger: "#e7655f",
  info: "#6fa7d8",
} as const;

export type PaletteToken = keyof typeof palette;

export const hex = (token: PaletteToken): string => palette[token];

export const cssVar = (token: PaletteToken): string => `var(--sens-${token})`;


const lightSurfaces: Record<string, PaletteToken> = {
  bg: "bone-50",
  surface: "paper",
  "surface-subtle": "bone-100",
  text: "carbon-950",
  "text-muted": "alloy-500",
  border: "bone-200",
  focus: "signal-700",
};

const darkSurfaces: Record<string, PaletteToken> = {
  bg: "carbon-950",
  surface: "carbon-900",
  "surface-subtle": "carbon-800",
  text: "bone-50",
  "text-muted": "alloy-400",
  border: "carbon-700",
  focus: "signal-500",
};

const declarations = (entries: [string, string][], indent: string): string =>
  entries.map(([name, value]) => `${indent}${name}: ${value};`).join("\n");

const primitiveDeclarations = (indent: string): string =>
  declarations(
    Object.entries(palette).map(([token, value]) => [`--sens-${token}`, value]),
    indent,
  );

const surfaceDeclarations = (
  surfaces: Record<string, PaletteToken>,
  indent: string,
): string =>
  declarations(
    Object.entries(surfaces).map(([name, token]) => [
      `--sens-${name}`,
      cssVar(token),
    ]),
    indent,
  );


export const brandTokensCss = (): string =>
  [
    ":root {",
    primitiveDeclarations("  "),
    surfaceDeclarations(lightSurfaces, "  "),
    "}",
    "",
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    surfaceDeclarations(darkSurfaces, "    "),
    "  }",
    "}",
    "",
    ':root[data-theme="dark"] {',
    surfaceDeclarations(darkSurfaces, "  "),
    "}",
    "",
  ].join("\n");

export const fontSans =
  "Geist, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export const fontMono =
  '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const radius = {
  control: 8,
  panel: 12,
  sheet: 16,
  pill: 999,
} as const;

export const motion = {
  hover: "140ms",
  panel: "200ms",
  confirm: "560ms",
  scan: "1100ms",
  ease: "cubic-bezier(.2,.6,.3,1)",
} as const;

export const scan = {
  frames: ["●··", "·●·", "··●"],
  interval: 340,
} as const;

export const terminal = {
  brand: hex("signal-500"),
  focus: hex("signal-500"),
  text: hex("bone-50"),
  meta: hex("alloy-400"),
  ok: hex("success"),
  warn: hex("warning"),
  err: hex("danger"),
  info: hex("info"),
} as const;
