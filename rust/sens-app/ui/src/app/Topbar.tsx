import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { focused, panes } from "../features/panes/store";
import { project } from "../features/project/store";
import { runningTasks, tasks } from "../features/tasks/store";
import { consoles, runningConsoles } from "../features/terminal/store";
import { openUpdate } from "../features/updates/UpdatePanel";
import { updates } from "../features/updates/store";
import { anchorMenu } from "../shared/anchorMenu";
import { shared } from "../shared/copy";
import { stem } from "../shared/format.js";
import { Icon } from "../shared/Icon";
import { ICONS } from "../shared/icons.js";
import { Mark } from "../shared/Mark";
import { useSheet, type Sheet } from "../shared/useSheet";
import { t } from "./copy";
import { panelShows, railFolded, shell, showTool, toggleRail, type Tool } from "./shell";

// The title bar Sens draws instead of the system's: the rail switch, the
// brand, an update when there is one, the tools, and the window's controls.
// It drags the window.
export function Topbar() {
  const closed = useStore(shell, railFolded);
  const label = closed ? t.showSidebar : t.hideSidebar;
  return (
    <header className="topbar">
      <button
        className="icon-btn rail-toggle"
        id="toggle-rail"
        aria-controls="rail"
        aria-expanded={!closed}
        aria-keyshortcuts="Control+B"
        title={`${label} (${shared.ctrl}+B)`}
        aria-label={label}
        onClick={toggleRail}
      >
        <Icon svg={closed ? ICONS.panelOpen : ICONS.panelClose} />
      </button>
      <div className="brand">
        <Mark size={18} micro />
        <b>sens</b>
      </div>
      <ProjectTitle />
      <UpdatePill />
      <Window />
    </header>
  );
}

function ProjectTitle() {
  const root = useStore(project, (s) => s.root);
  if (!root) return null;
  return (
    <div className="topbar-title" id="project-title">
      {stem(root)}
    </div>
  );
}

function UpdatePill() {
  const latest = useStore(updates, (s) => s.latest);
  if (!latest) return null;
  return (
    <button
      className="update-pill"
      id="update"
      aria-label={t.updateAvailable(latest.version)}
      title={t.versionAvailable(latest.version)}
      onClick={(event) => openUpdate(event.currentTarget)}
    >
      <span className="update-ping" aria-hidden="true" />
      <Icon svg={ICONS.update} />
      <span>{t.update}</span>
      <span className="update-version">{latest.version}</span>
    </button>
  );
}

export function Window({ tools = true }: { tools?: boolean }) {
  const frame = getCurrentWindow();
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const sync = () => frame.isMaximized().then(setWide, () => {});
    sync();
    const stop = frame.onResized(sync);
    return () => {
      stop.then((unlisten) => unlisten());
    };
  }, []);

  const grow = wide ? t.restore : t.maximize;
  return (
    <div className="win" id="win" data-max={String(wide)}>
      {tools && <ToolsButton />}
      <button id="win-min" title={t.minimize} aria-label={t.minimize} onClick={() => frame.minimize()}>
        <Icon svg={ICONS.minimize} />
      </button>
      <button id="win-max" title={grow} aria-label={grow} onClick={() => frame.toggleMaximize().then(() => frame.isMaximized().then(setWide))}>
        <span className="grow">
          <Icon svg={ICONS.maximize} />
        </span>
        <span className="restore">
          <Icon svg={ICONS.restore} />
        </span>
      </button>
      <button className="shut" id="win-close" title={shared.close} aria-label={shared.close} onClick={() => frame.close()}>
        <Icon svg={ICONS.shutWindow} />
      </button>
    </div>
  );
}

const TOOLS: { tool: Tool; icon: string }[] = [
  { tool: "files", icon: ICONS.files },
  { tool: "changes", icon: ICONS.compare },
  { tool: "web", icon: ICONS.globe },
  { tool: "terminal", icon: ICONS.terminal },
  { tool: "tasks", icon: ICONS.activity },
];

// The tools of the right panel; a dot while background work runs.
function ToolsButton() {
  const sheet = useSheet();
  const running = useStore(tasks, () => runningTasks());
  return (
    <>
      <button
        className="tools-btn"
        id="tools"
        ref={sheet.anchor}
        title={t.tools}
        aria-label={t.tools}
        aria-haspopup="menu"
        aria-expanded={sheet.open}
        data-running={String(running > 0)}
        onClick={sheet.toggle}
      >
        <Icon svg={ICONS.moreVertical} />
      </button>
      {createPortal(<ToolsMenu sheet={sheet} />, document.body)}
    </>
  );
}

function ToolsMenu({ sheet }: { sheet: Sheet }) {
  const pane = useStore(panes, () => focused());
  const dirty = useStore(pane.desk, (s) => s.repo?.dirty ?? 0);
  const running = useStore(tasks, () => runningTasks());
  const shells = useStore(consoles, () => runningConsoles());
  useStore(shell, (s) => `${s.toolsOpen}/${s.tool}`);

  useLayoutEffect(() => {
    if (sheet.open && sheet.sheet.ref.current && sheet.anchor.current) anchorMenu(sheet.sheet.ref.current, sheet.anchor.current);
  }, [sheet.open]);

  const counts: Partial<Record<Tool, number>> = { changes: dirty, tasks: running, terminal: shells };
  const count = (tool: Tool) => (counts[tool] ? String(counts[tool]) : "");
  return (
    <div className="sheet menu float-menu tool-menu" id="tool-menu" role="menu" aria-label={t.tools} {...sheet.sheet}>
      {TOOLS.map((one) => (
        <button
          key={one.tool}
          type="button"
          className="menu-item"
          tabIndex={-1}
          role="menuitemradio"
          aria-checked={panelShows(one.tool)}
          onClick={() => {
            sheet.shut();
            showTool(one.tool);
          }}
        >
          <span className="act-icon">
            <Icon svg={one.icon} />
          </span>
          <span className="mode-text">
            <span>{t.tool[one.tool]}</span>
            <span className="mode-sub">{t.toolSaid[one.tool]}</span>
          </span>
          <span className="tool-count">{count(one.tool)}</span>
        </button>
      ))}
    </div>
  );
}
