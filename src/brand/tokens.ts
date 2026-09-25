export const palette = {
  "carbon-950": "#0c0d0d",
  "carbon-900": "#111313",
  "carbon-800": "#1a1d1c",
  "carbon-700": "#252927",
  "carbon-600": "#363b38",
  "alloy-600": "#595f5c",
  "alloy-550": "#666d69",
  "alloy-500": "#747b77",
  "alloy-400": "#929995",
  "alloy-300": "#b5bbb7",
  "bone-300": "#d1cfc8",
  "bone-200": "#dddcd5",
  "bone-100": "#eceae3",
  "bone-50": "#f4f1ea",
  paper: "#fbfaf6",
  "chalk-0": "#ffffff",
  "chalk-50": "#f7f9f8",
  "chalk-100": "#ebeeed",
  "chalk-200": "#e1e5e3",
  "chalk-300": "#d4d9d6",
  "chalk-400": "#bcc2bf",
  "signal-800": "#4e700d",
  "signal-700": "#78aa12",
  "signal-600": "#a9e52d",
  "signal-500": "#c7ff4a",
  "signal-200": "#e4ffa5",
  "signal-100": "#f0ffd0",
  "signal-tint-900": "#1a1f16",
  "signal-tint-700": "#353e2a",
  "signal-tint-100": "#eff7e5",
  "signal-tint-300": "#d0e1b6",
  "ice-800": "#007082",
  "ice-700": "#009bb4",
  "ice-600": "#00c9e9",
  "ice-500": "#4ee1ff",
  "ice-200": "#ccf5ff",
  "ice-100": "#e9fbff",
  "ice-tint-900": "#131f22",
  "ice-tint-700": "#243f45",
  "ice-tint-100": "#e2f8fe",
  "ice-tint-300": "#ace4f1",
  "iris-800": "#665798",
  "iris-700": "#836cca",
  "iris-600": "#a184f7",
  "iris-500": "#b6a2ff",
  "iris-200": "#edeaff",
  "iris-100": "#f7f5ff",
  "iris-tint-900": "#1d1c25",
  "iris-tint-700": "#3b374b",
  "iris-tint-100": "#f4f1ff",
  "iris-tint-300": "#dad2fe",
  "rose-800": "#914669",
  "rose-700": "#c15588",
  "rose-600": "#ed69a8",
  "rose-500": "#ff8abe",
  "rose-200": "#ffe5ef",
  "rose-100": "#fff3f7",
  "rose-tint-900": "#241a1e",
  "rose-tint-700": "#49333c",
  "rose-tint-100": "#ffedf5",
  "rose-tint-300": "#fac9dc",
  success: "#43c878",
  warning: "#e7b84b",
  danger: "#e7655f",
  info: "#6fa7d8",
  "success-700": "#11733e",
  "warning-700": "#895b00",
  "danger-700": "#b63132",
  "info-700": "#2e6b9c",
  "success-300": "#79e29b",
  "warning-300": "#f8ce73",
  "danger-300": "#fe8b83",
  "info-300": "#90c4f2",
  "lang-amber": "#d8b24a",
  "lang-azure": "#5b8fc9",
  "lang-ember": "#d08248",
  "lang-moss": "#5aa86f",
  "lang-iris": "#9b87c4",
  "lang-stone": "#8a918d",
} as const;

export type PaletteToken = keyof typeof palette;

export const hex = (token: PaletteToken): string => palette[token];

export const cssVar = (token: PaletteToken): string => `var(--sens-${token})`;

export const accents = ["signal", "ice", "iris", "rose", "neutral"] as const;

export type Accent = (typeof accents)[number];

export const ramp = ["100", "200", "500", "600", "700", "800", "tint-900", "tint-700", "tint-100", "tint-300"] as const;


const lightSurfaces: Record<string, PaletteToken> = {
  bg: "chalk-0",
  surface: "chalk-50",
  "surface-subtle": "chalk-100",
  text: "carbon-950",
  "text-muted": "alloy-600",
  border: "chalk-200",
  focus: "signal-800",
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
  "Space Grotesk, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

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
