import { iconShape } from "./icons.js";

// One of ICONS as the same <svg> the legacy script writes with innerHTML.
// Anything else draws nothing rather than breaking the zone.
export function Icon({ svg }: { svg: string }) {
  const shape = iconShape(svg);
  if (!shape) return null;
  const { paths, size, stroke } = shape;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}
