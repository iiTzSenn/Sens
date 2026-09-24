import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { linearRgb, look, tokenOf } from "./look";
import { Mark } from "./Mark";
import { mountStone, type Stone, type StoneState } from "./stone";

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
      {flat && <Mark className="stone-flat" />}
    </div>
  );
}
