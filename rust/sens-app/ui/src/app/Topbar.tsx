import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { focused, panes } from "../features/panes/store";
import { project } from "../features/project/store";
import { runningTasks, tasks } from "../features/tasks/store";
import { openUpdate } from "../features/updates/UpdatePanel";
import { updates } from "../features/updates/store";
import { anchorMenu } from "../shared/anchorMenu";
import { stem } from "../shared/format.js";
import { Icon } from "../shared/Icon";
import { ICONS } from "../shared/icons.js";
import { useSheet, type Sheet } from "../shared/useSheet";
import { panelShows, railFolded, shell, showTool, toggleRail, type Tool } from "./shell";

// The title bar Sens draws instead of the system's: the rail switch, the
// brand, an update when there is one, the tools, and the window's controls.
// It drags the window.
export function Topbar() {
  const closed = useStore(shell, railFolded);
  const label = closed ? "Mostrar la barra lateral" : "Ocultar la barra lateral";
  return (
    <header className="topbar">
      <button
        className="icon-btn rail-toggle"
        id="toggle-rail"
        aria-controls="rail"
        aria-expanded={!closed}
        aria-keyshortcuts="Control+B"
        title={`${label} (Ctrl+B)`}
        aria-label={label}
        onClick={toggleRail}
      >
        <Icon svg={closed ? ICONS.panelOpen : ICONS.panelClose} />
      </button>
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <clipPath id="sens-brand-body">
              <rect width="48" height="48" rx="11" />
            </clipPath>
          </defs>
          <g clipPath="url(#sens-brand-body)">
            <rect width="48" height="48" fill="var(--sens-carbon-800)" />
            <path
              d="M48 13C41 13 35 8.5 29 8.5C21 8.5 13.5 13 13.5 18.5C13.5 23 19 21.8 24 24C29 26.2 34.5 25 34.5 29.5C34.5 35 27 39.5 19 39.5C13 39.5 7 35 0 35"
              fill="none"
              stroke="var(--sens-signal-500)"
              strokeWidth="4.6"
              strokeLinecap="round"
            />
          </g>
        </svg>
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
      aria-label={`Actualización disponible: Sens ${latest.version}`}
      title={`Sens ${latest.version} disponible`}
      onClick={(event) => openUpdate(event.currentTarget)}
    >
      <span className="update-ping" aria-hidden="true" />
      <Icon svg={ICONS.update} />
      <span>Actualizar</span>
      <span className="update-version">{latest.version}</span>
    </button>
  );
}

function Window() {
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

  const grow = wide ? "Restaurar" : "Maximizar";
  return (
    <div className="win" id="win" data-max={String(wide)}>
      <ToolsButton />
      <button id="win-min" title="Minimizar" aria-label="Minimizar" onClick={() => frame.minimize()}>
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
      <button className="shut" id="win-close" title="Cerrar" aria-label="Cerrar" onClick={() => frame.close()}>
        <Icon svg={ICONS.shutWindow} />
      </button>
    </div>
  );
}

const TOOLS: { tool: Tool; label: string; said: string; icon: string }[] = [
  { tool: "files", label: "Ficheros", said: "El árbol y el código del proyecto", icon: ICONS.files },
  { tool: "changes", label: "Cambios", said: "Lo que difiere del último commit", icon: ICONS.compare },
  { tool: "web", label: "Web", said: "Páginas y servidores locales", icon: ICONS.globe },
  { tool: "tasks", label: "Segundo plano", said: "Subagentes y comandos del modelo", icon: ICONS.activity },
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
        title="Herramientas"
        aria-label="Herramientas"
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
  useStore(shell, (s) => `${s.toolsOpen}/${s.tool}`);

  useLayoutEffect(() => {
    if (sheet.open && sheet.sheet.ref.current && sheet.anchor.current) anchorMenu(sheet.sheet.ref.current, sheet.anchor.current);
  }, [sheet.open]);

  const count = (tool: Tool) => (tool === "changes" && dirty ? String(dirty) : tool === "tasks" && running ? String(running) : "");
  return (
    <div className="sheet menu float-menu tool-menu" id="tool-menu" role="menu" aria-label="Herramientas" {...sheet.sheet}>
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
            <span>{one.label}</span>
            <span className="mode-sub">{one.said}</span>
          </span>
          <span className="tool-count">{count(one.tool)}</span>
        </button>
      ))}
    </div>
  );
}
