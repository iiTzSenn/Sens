import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown, type Fade } from "../../shared/markdown/Markdown";
import { mended, parse, splitBlocks, textLength } from "../../shared/markdown/parse";
import type { Said as SaidPart } from "./turns";

// A streamed reply is revealed a little every frame: at least a few
// characters, more the further behind it is, to the end of a word.
const REVEAL_FLOOR = 3;
const REVEAL_SPREAD = 8;
const WORD_REACH = 24;
// How long new text takes to fade in.
const FADE = 150;

export const Frozen = memo(function Frozen({ text }: { text: string }) {
  return <Markdown text={text} />;
});

// What the model wrote. Blocks already whole are drawn once; the one being
// written is drawn again each frame, mended, with its newest text fading in.
// Once all of it shows and no more comes, it is drawn as one page.
export const Said = memo(function Said({ part }: { part: SaidPart }) {
  const { text, streamed, settled, done } = part;
  const [shown, setShown] = useState(streamed ? 0 : text.length);
  const seen = useRef(text);
  const live = useRef({ block: -1, length: 0, stamps: [] as Fade["stamps"] });

  // Text that does not continue what shows (a reply settled differently), a
  // turn that ended, or a hidden window: all of it at once.
  useLayoutEffect(() => {
    const kept = seen.current.slice(0, shown);
    seen.current = text;
    if (!streamed || done || !text.startsWith(kept) || document.hidden) setShown(text.length);
  }, [text, streamed, done]);

  useEffect(() => {
    if (shown >= text.length) return;
    const frame = requestAnimationFrame(() => {
      const backlog = text.length - shown;
      let next = Math.min(text.length, shown + Math.max(REVEAL_FLOOR, Math.ceil(backlog / REVEAL_SPREAD)));
      const space = text.slice(next, next + WORD_REACH).search(/\s/);
      if (next < text.length && space > 0) next += space;
      setShown(document.hidden ? text.length : next);
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, text]);

  if (shown >= text.length && (settled || done)) {
    return (
      <div className="said">
        <Markdown text={text} />
      </div>
    );
  }

  const blocks = splitBlocks(text.slice(0, shown));
  const writing = mended(blocks.at(-1) || "");
  const now = performance.now();
  const at = live.current;
  if (at.block !== blocks.length - 1) Object.assign(at, { block: blocks.length - 1, length: 0, stamps: [] });
  const length = textLength(parse(writing));
  if (length > at.length) at.stamps.push({ from: at.length, time: now });
  at.length = length;
  at.stamps = at.stamps.filter((stamp) => now - stamp.time < FADE);

  return (
    <div className="said">
      {blocks.slice(0, -1).map((block, index) => (
        <Frozen key={index} text={block} />
      ))}
      <Markdown text={writing} fade={{ stamps: at.stamps, now }} />
    </div>
  );
});
