import { useLayoutEffect, useRef } from "react";
import { legacy } from "../legacy/bridge";

// Markdown through the chat's renderer: its nodes go into this .prose, which
// React never fills itself.
export function Prose({ text }: { text: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    host.current?.replaceChildren(...legacy.prose(text).childNodes);
  }, [text]);
  return <div className="prose" ref={host} />;
}
