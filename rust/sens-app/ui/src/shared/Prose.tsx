import { legacy } from "../legacy/bridge";
import { useBorrowed } from "./Borrowed";

// Markdown through the chat's renderer: its nodes go into this .prose.
export function Prose({ text }: { text: string }) {
  const host = useBorrowed(() => [...legacy.prose(text).childNodes], [text]);
  return <div className="prose" ref={host} />;
}
