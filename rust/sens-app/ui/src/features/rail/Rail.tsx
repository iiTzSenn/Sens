import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import type { SessionSummary, Workspace } from "../../ipc/types";
import { legacy } from "../../legacy/bridge";
import { anchorMenu } from "../../shared/anchorMenu";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { useSheet } from "../../shared/useSheet";
import { project, type View } from "../project/store";
import { Me } from "./Me";
import { archiveSession, deleteSession, fold, rail, renameSession } from "./store";

const TITLE_LIMIT = 56;

// The sidebar: where to go, the projects with their sessions, and who is
// using Sens. app.js keeps the rail itself (folding it, its width).
export function mountRail(host: Element) {
  createRoot(host).render(
    <StrictMode>
      <Rail />
    </StrictMode>,
  );
}

export function Rail() {
  return (
    <>
      <Nav />
      <Sessions />
      <Me />
    </>
  );
}

const VIEWS: { view: View; label: string; icon: string }[] = [
  { view: "capabilities", label: "Capacidades", icon: ICONS.shapes },
  { view: "artifacts", label: "Artefactos", icon: ICONS.files },
];

function Nav() {
  const drafting = useStore(project, (s) => Boolean(s.root) && !s.session && !s.view);
  const view = useStore(project, (s) => s.view);
  return (
    <div className="rail-nav">
      <button className="nav-row" id="new-session" aria-keyshortcuts="Control+N" aria-current={drafting} onClick={() => legacy.fresh()}>
        <span className="nav-icon">
          <Icon svg={ICONS.pen} />
        </span>
        <span className="nav-label">Sesión nueva</span>
        <span className="hint-keys" aria-hidden="true">
          <kbd>Ctrl</kbd>
          <kbd>N</kbd>
        </span>
      </button>
      {VIEWS.map((one) => (
        <button key={one.view} className="nav-row" id={one.view} aria-current={view === one.view} onClick={() => legacy.showView(one.view)}>
          <span className="nav-icon">
            <Icon svg={one.icon} />
          </span>
          <span className="nav-label">{one.label}</span>
        </button>
      ))}
    </div>
  );
}

interface Managed {
  home: string;
  summary: SessionSummary;
}

// Keyboard focus goes back to the row a change came from, or to "Sesión nueva"
// when the row is gone, once the list is drawn again.
function backToRow(id: string) {
  requestAnimationFrame(() => {
    const dots = document.querySelector<HTMLElement>(`.session-row[data-session="${CSS.escape(id)}"] .dots`);
    (dots ?? document.getElementById("new-session"))?.focus();
  });
}

function Sessions() {
  const spaces = useStore(rail, (s) => s.spaces);
  const folded = useStore(rail, (s) => s.folded);
  const fault = useStore(rail, (s) => s.fault);
  const menu = useSheet();
  const [managed, setManaged] = useState<Managed | null>(null);
  const [renaming, setRenaming] = useState("");

  // One menu serves every row: it opens by the row's dots.
  function manage(dots: HTMLButtonElement, one: Managed) {
    if (menu.open && menu.anchor.current === dots) return menu.shut();
    menu.anchor.current = dots;
    setManaged(one);
    if (!menu.open) menu.toggle();
  }

  return (
    <div className="sessions" id="sessions" onScroll={menu.shut}>
      {fault && (
        <p className="none fault" role="alert">
          {fault}
        </p>
      )}
      {spaces?.map((space) => (
        <Project
          key={space.root}
          space={space}
          shut={folded.has(space.root)}
          renaming={renaming}
          managing={menu.open ? managed?.summary.id : undefined}
          manage={manage}
          renamed={(id) => {
            setRenaming("");
            backToRow(id);
          }}
        />
      ))}
      {spaces?.length === 0 && <EmptyRail />}
      {createPortal(
        <RowMenu
          menu={menu}
          managed={managed}
          rename={() => {
            menu.shut();
            if (managed) setRenaming(managed.summary.id);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

function EmptyRail() {
  return (
    <div className="rail-empty">
      <Icon svg={ICONS.folder} />
      <p>Todavía no hay sesiones.</p>
      <button onClick={() => legacy.chooseFolder()}>
        <Icon svg={ICONS.plus} />
        Abrir proyecto
      </button>
    </div>
  );
}

interface ProjectProps {
  space: Workspace;
  shut: boolean;
  renaming: string;
  managing?: string;
  manage: (dots: HTMLButtonElement, one: Managed) => void;
  renamed: (id: string) => void;
}

// Archived sessions go last; a folded project keeps its rows, out of reach.
function Project({ space, shut, renaming, managing, manage, renamed }: ProjectProps) {
  const here = useStore(project, (s) => s.root === space.root);
  const ordered = [...space.sessions].sort((one, two) => Number(one.archived) - Number(two.archived));
  return (
    <div className="project">
      <div className="project-head">
        <button className="fold" title={space.root} aria-expanded={!shut} data-here={here ? "true" : undefined} onClick={() => fold(space.root, !shut)}>
          <span className="chev">
            <Icon svg={ICONS.open} />
          </span>
          <span className="name">{space.name}</span>
        </button>
        <button className="add" title={`Sesión nueva en ${space.name}`} aria-label={`Sesión nueva en ${space.name}`} onClick={() => legacy.draft(space.root)}>
          <Icon svg={ICONS.plus} />
        </button>
      </div>
      <div className="runs" data-shut={String(shut)}>
        <div className="runs-inner" inert={shut}>
          {ordered.map((summary) => (
            <SessionRow
              key={summary.id}
              home={space.root}
              summary={summary}
              renaming={renaming === summary.id}
              managed={managing === summary.id}
              manage={(dots) => manage(dots, { home: space.root, summary })}
              renamed={() => renamed(summary.id)}
            />
          ))}
          {!space.sessions.length && <p className="none">Sin sesiones.</p>}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  home: string;
  summary: SessionSummary;
  renaming: boolean;
  managed: boolean;
  manage: (dots: HTMLButtonElement) => void;
  renamed: () => void;
}

function SessionRow({ home, summary, renaming, managed, manage, renamed }: RowProps) {
  const current = useStore(project, (s) => !s.view && s.root === home && s.session === summary.id);
  const said = [summary.title, `${summary.tasks} ${summary.tasks === 1 ? "mensaje" : "mensajes"}`, summary.archived ? "archivada" : ""];
  return (
    <div className="session-row" data-session={summary.id} data-current={String(current)} data-renaming={renaming ? "true" : undefined}>
      {renaming && <Rename home={home} summary={summary} done={renamed} />}
      <button className="session" aria-current={current} title={said.filter(Boolean).join(" · ")} onClick={() => legacy.resume(home, summary.id)}>
        <span className="name">{summary.title}</span>
        {summary.archived && (
          <span className="kept">
            <Icon svg={ICONS.box} />
          </span>
        )}
      </button>
      <button
        className="dots"
        title="Gestionar sesión"
        aria-label="Gestionar sesión"
        aria-haspopup="menu"
        aria-expanded={managed}
        onClick={(event) => manage(event.currentTarget)}
      >
        <Icon svg={ICONS.ellipsis} />
      </button>
    </div>
  );
}

// Enter keeps the new name, Escape the old one; leaving the field keeps it too,
// unless the whole window lost the focus.
function Rename({ home, summary, done }: { home: string; summary: SessionSummary; done: () => void }) {
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const [title, setTitle] = useState(summary.title);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  async function settle(keep: boolean) {
    if (settled.current) return;
    settled.current = true;
    const next = title.trim();
    if (keep && next && next !== summary.title) await renameSession(home, summary.id, next);
    done();
  }

  return (
    <input
      ref={field}
      className="field rename"
      value={title}
      maxLength={TITLE_LIMIT}
      spellCheck={false}
      autoComplete="off"
      aria-label="Nombre de la sesión"
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        settle(event.key === "Enter");
      }}
      onBlur={() => document.hasFocus() && settle(true)}
    />
  );
}

// Deleting asks twice: the first click turns the item into "Confirmar".
function RowMenu({ menu, managed, rename }: { menu: ReturnType<typeof useSheet>; managed: Managed | null; rename: () => void }) {
  const [armed, setArmed] = useState(false);

  useLayoutEffect(() => {
    setArmed(false);
    if (menu.open && menu.sheet.ref.current && menu.anchor.current) anchorMenu(menu.sheet.ref.current, menu.anchor.current);
  }, [menu.open, managed]);

  const act = (work: (one: Managed) => Promise<unknown>) => async () => {
    if (!managed) return;
    menu.shut();
    await work(managed);
    backToRow(managed.summary.id);
  };
  const kept = managed?.summary.archived;

  return (
    <div className="sheet menu float-menu" id="session-menu" role="menu" aria-label="Gestionar sesión" {...menu.sheet}>
      <button className="menu-item" role="menuitem" tabIndex={-1} onClick={rename}>
        <span className="act-icon">
          <Icon svg={ICONS.pencil} />
        </span>
        <span className="act-text">Renombrar</span>
      </button>
      <button className="menu-item" role="menuitem" tabIndex={-1} onClick={act((one) => archiveSession(one.home, one.summary))}>
        <span className="act-icon">
          <Icon svg={kept ? ICONS.unarchive : ICONS.archive} />
        </span>
        <span className="act-text">{kept ? "Desarchivar" : "Archivar"}</span>
      </button>
      <button
        className="menu-item risky"
        role="menuitem"
        tabIndex={-1}
        data-armed={String(armed)}
        onClick={armed ? act((one) => deleteSession(one.home, one.summary.id)) : () => setArmed(true)}
      >
        <span className="act-icon">
          <Icon svg={ICONS.trash} />
        </span>
        <span className="act-text">{armed ? "Confirmar" : "Eliminar"}</span>
      </button>
    </div>
  );
}
