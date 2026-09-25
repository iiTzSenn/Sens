import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useStore } from "zustand";
import { ChangeTotals, ChangesPanel } from "../features/changes/Changes";
import { loadChanges } from "../features/changes/store";
import { Tree } from "../features/files/Tree";
import { Viewer, ViewerHead, ViewerModes } from "../features/files/Viewer";
import { TaskTally, TasksPanel } from "../features/tasks/TasksPanel";
import { ConsolePanel, ConsoleTabs, ConsoleTools } from "../features/terminal/Consoles";
import { Address, Outside, Web } from "../features/web/Web";
import { shared } from "../shared/copy";
import { Icon } from "../shared/Icon";
import { ICONS } from "../shared/icons.js";
import { t } from "./copy";
import { closeTools, shell, toggleTree, type Tool } from "./shell";
import { Splitter } from "./Splitter";

// The panel on the right: one tool at a time, each with its header.
export function ToolsPanel({ pane }: { pane?: RefObject<HTMLElement | null> }) {
  const tool = useStore(shell, (s) => s.tool);
  return (
    <aside className="code" id="code" data-tool={tool} ref={pane}>
      <Section tool="files" head={<ViewerHead />} tools={<FilesTools />}>
        <Files />
      </Section>
      <Section
        tool="changes"
        head={
          <>
            <span className="tool-name">{t.tool.changes}</span>
            <span className="marks" id="change-marks">
              <ChangeTotals />
            </span>
          </>
        }
        tools={
          <button className="icon-btn" id="changes-reload" title={t.refresh} aria-label={t.refresh} onClick={loadChanges}>
            <Icon svg={ICONS.refresh} />
          </button>
        }
      >
        <div className="tool-body" id="changes" aria-live="polite">
          <ChangesPanel />
        </div>
      </Section>
      <Section tool="web" head={<Address />} tools={<Outside />}>
        <div className="site" id="site">
          <Web />
        </div>
      </Section>
      <Section tool="terminal" head={<ConsoleTabs />} tools={<ConsoleTools />}>
        <ConsolePanel />
      </Section>
      <Section
        tool="tasks"
        head={
          <>
            <span className="tool-name">{t.tool.tasks}</span>
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

function Section({ tool, head, tools, children }: { tool: Tool; head: ReactNode; tools?: ReactNode; children: ReactNode }) {
  const shown = useStore(shell, (s) => s.tool === tool);
  return (
    <section className="tool" data-tool={tool} aria-label={t.tool[tool]} hidden={!shown}>
      <div className="code-head">
        {head}
        <div className="code-tools">
          {tools}
          <button className="icon-btn shut-tool" title={shared.close} aria-label={shared.close} onClick={closeTools}>
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
      <button className="icon-btn" id="toggle-tree" title={t.fileTree} aria-pressed={shown} onClick={toggleTree}>
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
      <Splitter id="tree-split" label={t.treeWidth} name="--tree-width" host={body} pane={tree} grow={1} />
      <Viewer />
    </div>
  );
}
