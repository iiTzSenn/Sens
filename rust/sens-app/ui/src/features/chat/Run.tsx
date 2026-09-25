import { memo, useState } from "react";
import { seconds } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Step } from "./Step";
import { Thought } from "./Thought";
import { t } from "./thread.copy";
import { sameWork, tally, type Tally, type Work } from "./work";

export const Run = memo(
  function Run({ parts, folded }: { parts: Work[]; folded: boolean }) {
    const [opened, setOpened] = useState(false);
    const told = folded ? tally(parts) : null;
    return (
      <details
        className="run"
        open={!folded || opened}
        data-folded={String(folded)}
        data-failed={told?.failed ? "true" : undefined}
        onToggle={(event) => folded && setOpened(event.currentTarget.open)}
      >
        <summary className="run-head" hidden={!told}>
          {told && <Head told={told} />}
        </summary>
        <div className="run-steps">
          {parts.map((part) => (part.kind === "thought" ? <Thought key={part.key} part={part} /> : <Step key={part.key} part={part} />))}
        </div>
      </details>
    );
  },
  (was, now) => was.folded === now.folded && sameWork(was.parts, now.parts),
);

function Head({ told }: { told: Tally }) {
  const counts = [
    told.commands && t.commands(told.commands),
    told.reads && t.reads(told.reads),
    told.edits && t.edits(told.edits),
    told.searches && t.searches(told.searches),
    told.others && t.others(told.others),
  ].filter(Boolean);
  return (
    <>
      <span className="run-icon">
        <Icon svg={ICONS.shut} />
      </span>
      <span className="run-verb">{t.worked}</span>
      <span className="run-tally">{counts.join(" · ")}</span>
      {told.failed > 0 && <span className="run-failed">{t.failed(told.failed)}</span>}
      <span className="run-time">{told.took === null ? "" : seconds(told.took)}</span>
      <span className="run-state" />
    </>
  );
}
