import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { linearRgb, look, tokenOf } from "./look";
import { mountStone, type Stone, type StoneState } from "./stone";

const CUT = "M48 13C41 13 35 8.5 29 8.5C21 8.5 13.5 13 13.5 18.5C13.5 23 19 21.8 24 24C29 26.2 34.5 25 34.5 29.5C34.5 35 27 39.5 19 39.5C13 39.5 7 35 0 35";

const tintOf = (stone: Stone, light: boolean) => {
  const [signal, hot] = [tokenOf("--glow"), tokenOf("--glow-hot")];
  if (signal.startsWith("#") && hot.startsWith("#")) stone.tint(linearRgb(signal), linearRgb(hot), light);
};

export function StoneCanvas({ state, replay = "" }: { state: StoneState; replay?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const stone = useRef<Stone | null>(null);
  const [flat, setFlat] = useState(false);
  const accent = useStore(look, (s) => s.chosen.accent);
  const light = useStore(look, (s) => s.shown === "light");

  useEffect(() => {
    const canvas = document.createElement("canvas");
    holder.current?.append(canvas);
    const made = mountStone(canvas, state);
    if (!made) setFlat(true);
    stone.current = made;
    return () => {
      made?.destroy();
      canvas.remove();
      stone.current = null;
    };
  }, []);

  useEffect(() => {
    if (stone.current) tintOf(stone.current, light);
  }, [accent, light]);

  useEffect(() => {
    stone.current?.set(state);
  }, [state, replay]);

  return (
    <div className="stone-canvas" ref={holder} aria-hidden="true">
      {flat && (
        <svg className="stone-flat" viewBox="0 0 48 48">
          <defs>
            <clipPath id="stone-flat-body">
              <rect width="48" height="48" rx="11" />
            </clipPath>
          </defs>
          <g clipPath="url(#stone-flat-body)">
            <rect width="48" height="48" fill="var(--mark-body)" />
            <path d={CUT} fill="none" stroke="var(--glow)" strokeWidth="3" strokeLinecap="round" />
          </g>
        </svg>
      )}
    </div>
  );
}
