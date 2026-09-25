import { memo, useState } from "react";
import { seconds } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { mended, splitBlocks } from "../../shared/markdown/parse";
import { Frozen } from "./Said";
import { t } from "./thread.copy";
import type { Thought as ThoughtPart } from "./turns";
import { titleOf, tookOf } from "./work";

export const Thought = memo(function Thought({ part }: { part: ThoughtPart }) {
  const [seen, setSeen] = useState(false);
  const live = !part.done;
  const title = titleOf(part.text, live);
  const took = live ? null : tookOf(part);
  const empty = !part.text.trim();

  return (
    <details className={empty ? "thought empty" : "thought"} data-live={String(live)}>
      <summary onClick={(event) => (empty ? event.preventDefault() : setSeen(true))}>
        <span className="thought-icon">
          <Icon svg={ICONS.brain} />
        </span>
        <span className="thought-verb">{live ? t.thinking : t.thought}</span>
        <span key={title} className="thought-title" title={title || undefined}>
          {title}
        </span>
        <span className="thought-time">{took === null ? "" : seconds(took)}</span>
        <span className="thought-end" />
      </summary>
      <div className="thought-body">{seen && <Musing text={part.text} live={live} />}</div>
    </details>
  );
});

function Musing({ text, live }: { text: string; live: boolean }) {
  if (!live) return <Markdown text={text} />;
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.slice(0, -1).map((block, at) => (
        <Frozen key={at} text={block} />
      ))}
      <Markdown text={mended(blocks.at(-1) || "")} />
    </>
  );
}
