import { useEffect, useRef, type CSSProperties } from "react";
import { useStore } from "zustand";
import { Shelf } from "../features/artifacts/Shelf";
import { Capabilities } from "../features/capabilities/Capabilities";
import { NewsView } from "../features/news/News";
import { Panes } from "../features/panes/Panes";
import { project } from "../features/project/store";
import { Rail } from "../features/rail/Rail";
import { SettingsDialog } from "../features/settings/Settings";
import { settingsSheet } from "../features/settings/sheet";
import { openSettings } from "../features/settings/store";
import { Welcome } from "../features/welcome/Welcome";
import { sheets } from "../shared/sheets.js";
import { Dialog } from "./Dialog";
import { dialog } from "./modal";
import { chooseFolder, fresh } from "./session";
import { railFolded, shell, toggleRail } from "./shell";
import { Splitter } from "./Splitter";
import { ToolsPanel } from "./ToolsPanel";
import { Topbar } from "./Topbar";

// Ctrl and a letter, unless a dialog is open.
const HOTKEYS: Record<string, () => unknown> = { n: fresh, o: chooseFolder, b: toggleRail, ",": () => openSettings() };

// The whole window: the title bar; the rail, the chat or a view over it, and
// the tool panel, with the splitters between them; and the dialog.
export function App() {
  const railClosed = useStore(shell, railFolded);
  const toolsOpen = useStore(shell, (s) => s.toolsOpen);
  const sizingNow = useStore(shell, (s) => s.sizing);
  const sizes = useStore(shell, (s) => s.sizes);
  const view = useStore(project, (s) => s.view);
  const body = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const code = useRef<HTMLElement>(null);

  useEffect(() => {
    // A click outside a menu or a picker shuts it; Escape shuts it and gives
    // the focus back to what opened it.
    const outside = (event: PointerEvent) => {
      for (const one of sheets) {
        if (!one.sheet || one.sheet.hidden || one.sheet.contains(event.target as Node) || one.anchor?.contains(event.target as Node)) continue;
        one.shut();
      }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        for (const one of sheets) {
          if (!one.sheet || one.sheet.hidden) continue;
          one.shut();
          one.anchor?.focus();
        }
        return;
      }
      const act = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && HOTKEYS[event.key.toLowerCase()];
      if (!act) return;
      event.preventDefault();
      if (!dialog.getState().open && !settingsSheet.getState().open) act();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, []);

  const width = (name: string) => (sizes[name] ? `${sizes[name]}px` : undefined);
  return (
    <>
      <div className="app">
        <Topbar />
        <div
          className="body"
          id="body"
          ref={body}
          data-code={toolsOpen ? "open" : "closed"}
          data-rail={railClosed ? "closed" : "open"}
          data-sizing={sizingNow ? "true" : undefined}
          style={{ "--rail-width": width("--rail-width"), "--tools-width": width("--tools-width") } as CSSProperties}
        >
          <nav className="rail" id="rail" ref={rail} inert={railClosed}>
            <Rail />
          </nav>
          <Splitter id="rail-split" label="Ancho de la barra lateral" name="--rail-width" host={body} pane={rail} grow={1} />
          <section className="chat" hidden={Boolean(view)}>
            <Panes />
          </section>
          <section className="view" id="shelf" aria-label="Artefactos" hidden={view !== "artifacts"}>
            <div className="view-inner" id="shelf-body">
              <Shelf />
            </div>
          </section>
          <section className="view" id="capabilities-view" aria-label="Capacidades" hidden={view !== "capabilities"}>
            <div className="view-inner" id="capabilities-body">
              <Capabilities />
            </div>
          </section>
          <section className="view" id="news-view" aria-label="Novedades" hidden={view !== "news"}>
            <div className="view-inner news">
              <NewsView />
            </div>
          </section>
          <Splitter id="panel-split" label="Ancho del panel de herramientas" name="--tools-width" host={body} pane={code} grow={-1} />
          <ToolsPanel pane={code} />
        </div>
      </div>
      <SettingsDialog />
      <Dialog />
      <Welcome />
    </>
  );
}
