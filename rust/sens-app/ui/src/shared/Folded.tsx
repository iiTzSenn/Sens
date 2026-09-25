import { useState, type ReactNode } from "react";
import { shared } from "./copy";
import { Markdown } from "./markdown/Markdown";

const LONG_TEXT = 900;
const LONG_LINES = 12;

export const lengthy = (text: string) => text.length > LONG_TEXT || text.split("\n").length > LONG_LINES;

// Long content shows its top until asked for the rest.
export function Folded({ long, children }: { long: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const folded = long && !open;
  return (
    <div className="folded" data-folded={long ? String(folded) : undefined}>
      <div className="inside">{children}</div>
      {folded && (
        <button className="unfold" type="button" onClick={() => setOpen(true)}>
          {shared.showAll}
        </button>
      )}
    </div>
  );
}

// Markdown folded when it is long: a subagent's prompt, a page the model read.
export const FoldedText = ({ text }: { text: string }) => (
  <Folded long={lengthy(text)}>
    <Markdown text={text} />
  </Folded>
);
