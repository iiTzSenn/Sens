import { useId } from "react";

const CUT = "M48 13C41 13 35 8.5 29 8.5C21 8.5 13.5 13 13.5 18.5C13.5 23 19 21.8 24 24C29 26.2 34.5 25 34.5 29.5C34.5 35 27 39.5 19 39.5C13 39.5 7 35 0 35";
const CUT_WIDTH = 3;
const MICRO_CUT_WIDTH = 4.6;

export function Mark({ className, size, micro = false }: { className?: string; size?: number; micro?: boolean }) {
  const clip = `mark-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect width="48" height="48" rx="11" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="48" height="48" fill="var(--mark-body)" />
        <path d={CUT} pathLength={1} fill="none" stroke="var(--glow)" strokeWidth={micro ? MICRO_CUT_WIDTH : CUT_WIDTH} strokeLinecap="round" />
      </g>
    </svg>
  );
}
