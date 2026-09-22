import { hex } from "./tokens.js";

export const markSize = 48;
export const markRadius = 11;

export const cutPath =
  "M48 13C41 13 35 8.5 29 8.5C21 8.5 13.5 13 13.5 18.5C13.5 23 19 21.8 24 24C29 26.2 34.5 25 34.5 29.5C34.5 35 27 39.5 19 39.5C13 39.5 7 35 0 35";

export const cutWidth = 3;
export const microCutWidth = 4.6;

export const cutElement = (stroke: string, width = cutWidth): string =>
  `<path d="${cutPath}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;

export const bodyClip = (id: string): string =>
  `<clipPath id="${id}"><rect width="${markSize}" height="${markSize}" rx="${markRadius}"/></clipPath>`;

export const markFace = (
  body = hex("carbon-900"),
  cutColor = hex("signal-500"),
  width = cutWidth,
): string =>
  `<rect width="${markSize}" height="${markSize}" fill="${body}"/>${cutElement(cutColor, width)}`;

type MarkOptions = {
  size?: number;
  body?: string;
  cut?: string;
  micro?: boolean;
  id?: string;
  label?: string;
  decorative?: boolean;
};

const open = (size: number, decorative: boolean, label: string): string => {
  const role = decorative
    ? 'aria-hidden="true"'
    : `role="img" aria-label="${label}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${markSize} ${markSize}" ${role}>`;
};

export function markSvg(options: MarkOptions = {}): string {
  const {
    size = markSize,
    body = hex("carbon-900"),
    cut = hex("signal-500"),
    micro = false,
    id = "sens-mark",
    label = "sens",
    decorative = false,
  } = options;
  return [
    open(size, decorative, label),
    `<defs>${bodyClip(`${id}-body`)}</defs>`,
    `<g clip-path="url(#${id}-body)">`,
    markFace(body, cut, micro ? microCutWidth : cutWidth),
    "</g>",
    "</svg>",
  ].join("");
}

export function markMonoSvg(options: MarkOptions = {}): string {
  const {
    size = markSize,
    body = "currentColor",
    micro = false,
    id = "sens-mono",
    label = "sens",
    decorative = false,
  } = options;
  return [
    open(size, decorative, label),
    `<defs><mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${markSize}" height="${markSize}">`,
    `<rect width="${markSize}" height="${markSize}" rx="${markRadius}" fill="#fff"/>`,
    cutElement("#000", micro ? microCutWidth : cutWidth),
    "</mask></defs>",
    `<rect width="${markSize}" height="${markSize}" rx="${markRadius}" fill="${body}" mask="url(#${id}-cut)"/>`,
    "</svg>",
  ].join("");
}

