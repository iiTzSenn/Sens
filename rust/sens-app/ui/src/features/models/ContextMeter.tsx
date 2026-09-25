import { useStore } from "zustand";
import { compact } from "../../shared/format.js";
import { useSheet } from "../../shared/useSheet";
import { compactNow } from "../composer/store";
import { useIds, usePane } from "../panes/context";
import { t } from "./copy";
import { planLevel } from "./limits";
import { limitsShown, models } from "./store";
import { Mark, Usage, contextLevel } from "./Usage";

export function ContextMeter() {
  const pane = usePane();
  const id = useIds();
  const context = useStore(pane.chat, (s) => s.context);
  const limits = useStore(models, (s) => s.limits);
  useStore(models, (s) => s.account);
  const sheet = useSheet();
  if (!context?.used) return null;
  const share = Math.min(1, context.used / context.window);
  const percent = Math.round(share * 100);
  const tokens = t.contextOf(compact(context.used), compact(context.window));
  const plan = limitsShown() ? planLevel(limits) : "";
  const warning = plan === "over" ? t.over : plan ? t.near : "";
  return (
    <div className="pick-anchor meter" id={id("context")} data-level={contextLevel(share)}>
      <button
        className="meter-btn"
        id={id("context-pick")}
        ref={sheet.anchor}
        aria-haspopup="dialog"
        aria-expanded={sheet.open}
        aria-label={[t.contextUsed(t.percent(percent)), warning].filter(Boolean).join(" · ")}
        title={[t.contextTitle(tokens), warning].filter(Boolean).join(" · ")}
        onClick={sheet.toggle}
      >
        <svg className="meter-ring" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle className="meter-track" cx="8" cy="8" r="6" />
          <circle className="meter-fill" cx="8" cy="8" r="6" pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 8 8)" />
        </svg>
        <span>{t.percent(percent)}</span>
        <Mark level={plan} />
      </button>
      <div className="sheet meter-sheet" id={id("context-sheet")} role="dialog" aria-label={t.context} {...sheet.sheet}>
        <Usage
          pane={pane}
          open={sheet.open}
          onCompact={() => {
            sheet.shut();
            compactNow(pane);
          }}
        />
      </div>
    </div>
  );
}
