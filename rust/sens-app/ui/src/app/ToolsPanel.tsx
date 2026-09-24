import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useStore } from "zustand";
import { ChangeTotals, ChangesPanel } from "../features/changes/Changes";
import { loadChanges } from "../features/changes/store";
import { Tree } from "../features/files/Tree";
import { Viewer, ViewerHead, ViewerModes } from "../features/files/Viewer";
import { TaskTally, TasksPanel } from "../features/tasks/TasksPanel";
import { Address, Outside, Web } from "../features/web/Web";
import { Icon } from "../shared/Icon";
import { ICONS } from "../shared/icons.js";
import { closeTools, shell, toggleTree, type Tool } from "./shell";
import { Splitter } from "./Splitter";

// The panel on the right: one tool at a time, each with its header.
export function ToolsPanel({ pane }: { pane?: RefObject<HTMLElement | null> }) {
  const tool = useStore(shell, (s) => s.tool);
  return (
    <aside className="code" id="code" data-tool={tool} ref={pane}>
      <Section tool="files" label="Ficheros" head={<ViewerHead />} tools={<FilesTools />}>
        <Files />
      </Section>
      <Section
        tool="changes"
        label="Cambios"
        head={
          <>
            <span className="tool-name">Cambios</span>
            <span className="marks" id="change-marks">
              <ChangeTotals />
            </span>
          </>
        }
        tools={
          <button className="icon-btn" id="changes-reload" title="Actualizar" aria-label="Actualizar" onClick={loadChanges}>
            <Icon svg={ICONS.refresh} />
          </button>
        }
      >
        <div className="tool-body" id="changes" aria-live="polite">
          <ChangesPanel />
        </div>
      </Section>
      <Section tool="web" label="Web" head={<Address />} tools={<Outside />}>
        <div className="site" id="site">
          <Web />
        </div>
      </Section>
      <Section
        tool="tasks"
        label="Segundo plano"
        head={
          <>
            <span className="tool-name">Segundo plano</span>
            <span className="tool-tally" id="task-tally">
              <TaskTally />
            </span>
          </>
        }
      >
        <div className="tool-body" id="tasks">
          <TasksPanel />
        </div>
      </Section>
    </aside>
  );
}

function Section({ tool, label, head, tools, children }: { tool: Tool; label: string; head: ReactNode; tools?: ReactNode; children: ReactNode }) {
  const shown = useStore(shell, (s) => s.tool === tool);
  return (
    <section className="tool" data-tool={tool} aria-label={label} hidden={!shown}>
      <div className="code-head">
        {head}
        <div className="code-tools">
          {tools}
          <button className="icon-btn shut-tool" title="Cerrar" aria-label="Cerrar" onClick={closeTools}>
            <Icon svg={ICONS.close} />
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}

function FilesTools() {
  const shown = useStore(shell, (s) => s.treeShown);
  return (
    <>
      <ViewerModes />
      <button className="icon-btn" id="toggle-tree" title="Árbol de ficheros" aria-pressed={shown} onClick={toggleTree}>
        <Icon svg={ICONS.treeLines} />
      </button>
    </>
  );
}

// The tree beside the viewer, as wide as it was left.
function Files() {
  const shown = useStore(shell, (s) => s.treeShown);
  const width = useStore(shell, (s) => s.sizes["--tree-width"]);
  const body = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLDivElement>(null);
  return (
    <div className="code-body" id="code-body" data-tree={shown ? "shown" : "hidden"} ref={body} style={{ "--tree-width": width ? `${width}px` : undefined } as CSSProperties}>
      <div className="tree" id="tree" ref={tree}>
        <Tree />
      </div>
      <Splitter id="tree-split" label="Ancho del árbol de ficheros" name="--tree-width" host={body} pane={tree} grow={1} />
      <Viewer />
    </div>
  );
}
