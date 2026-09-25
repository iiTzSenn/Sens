import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import type { SessionSummary, Workspace } from "../../ipc/types";
import { chooseFolder, draft, dropShown, fresh, openBeside, resume, showView } from "../../app/session";
import { anchorMenu } from "../../shared/anchorMenu";
import { Icon } from "../../shared/Icon";
import { stem } from "../../shared/format.js";
import { ICONS } from "../../shared/icons.js";
import { shared } from "../../shared/copy";
import { useSheet, type Sheet } from "../../shared/useSheet";
import { distrust } from "../composer/store";
import { useShown } from "../panes/context";
import { drag, lift } from "../panes/drag";
import { project, type View } from "../project/store";
import { t } from "./copy";
import { Me } from "./Me";
import { activityOf, archiveSession, deleteSession, fold, rail, renameSession, type Activity } from "./store";

function ActivityMark({ activity }: { activity: Activity }) {
  return <span className="activity" data-activity={activity} role="img" aria-label={t.activity[activity]} />;
}

const TITLE_LIMIT = 56;

// The sidebar: where to go, the projects with their sessions, and who is
// using Sens.
export function Rail() {
  return (
    <>
      <Nav />
      <Sessions />
      <Me />
    </>
  );
}

const VIEWS: { view: Exclude<View, "" | "news">; icon: string }[] = [
  { view: "capabilities", icon: ICONS.shapes },
  { view: "artifacts", icon: ICONS.files },
];

function Nav() {
  const drafting = useStore(project, (s) => Boolean(s.root) && !s.session && !s.view);
  const view = useStore(project, (s) => s.view);
  return (
    <div className="rail-nav">
      <button className="nav-row" id="new-session" aria-keyshortcuts="Control+N" aria-current={drafting} onClick={() => fresh()}>
        <span className="nav-icon">
          <Icon svg={ICONS.pen} />
        </span>
        <span className="nav-label">{shared.newSession}</span>
        <span className="hint-keys" aria-hidden="true">
          <kbd>{shared.ctrl}</kbd>
          <kbd>N</kbd>
        </span>
      </button>
      {VIEWS.map((one) => (
        <button key={one.view} className="nav-row" id={one.view} aria-current={view === one.view} onClick={() => showView(one.view)}>
          <span className="nav-icon">
            <Icon svg={one.icon} />
          </span>
          <span className="nav-label">{t.view[one.view]}</span>
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

// One menu serves every row: it opens by the row's dots.
function useRowMenu<T>() {
  const menu = useSheet();
  const [target, setTarget] = useState<T | null>(null);
  function open(dots: HTMLButtonElement, one: T) {
    if (menu.open && menu.anchor.current === dots) return menu.shut();
    menu.anchor.current = dots;
    setTarget(one);
    if (!menu.open) menu.toggle();
  }
  return { menu, target, open };
}

function Sessions() {
  const spaces = useStore(rail, (s) => s.spaces);
  const folded = useStore(rail, (s) => s.folded);
  const fault = useStore(rail, (s) => s.fault);
  const { menu, target: managed, open: manage } = useRowMenu<Managed>();
  const folders = useRowMenu<string>();
  const { sessions, beside } = useShown();
  const [renaming, setRenaming] = useState("");

  return (
    <div
      className="sessions"
      id="sessions"
      onScroll={() => {
        menu.shut();
        folders.menu.shut();
      }}
    >
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
          beside={beside}
          managingFolder={folders.menu.open && folders.target === space.root}
          manageFolder={(dots) => folders.open(dots, space.root)}
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
          shown={sessions}
          rename={() => {
            menu.shut();
            if (managed) setRenaming(managed.summary.id);
          }}
        />,
        document.body,
      )}
      {createPortal(<FolderMenu menu={folders.menu} root={folders.target} />, document.body)}
    </div>
  );
}

function EmptyRail() {
  return (
    <div className="rail-empty">
      <Icon svg={ICONS.folder} />
      <p>{t.noSessionsYet}</p>
      <button onClick={() => chooseFolder()}>
        <Icon svg={ICONS.plus} />
        {t.openProject}
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
  beside: string;
  managingFolder: boolean;
  manageFolder: (dots: HTMLButtonElement) => void;
  renamed: (id: string) => void;
}

// Archived sessions go last; a folded project keeps its rows, out of reach.
function Project({ space, shut, renaming, managing, manage, beside, managingFolder, manageFolder, renamed }: ProjectProps) {
  const here = useStore(project, (s) => s.root === space.root);
  const busiest = useStore(rail, (s) => activityOf(space.sessions.map((one) => one.id), s.activity));
  const ordered = [...space.sessions].sort((one, two) => Number(one.archived) - Number(two.archived));
  return (
    <div className="project" data-root={space.root}>
      <div className="project-head">
        <button className="fold" title={space.root} aria-expanded={!shut} data-here={here ? "true" : undefined} onClick={() => fold(space.root, !shut)}>
          <span className="chev">
            <Icon svg={ICONS.open} />
          </span>
          <span className="name">{space.name}</span>
          {shut && busiest && <ActivityMark activity={busiest} />}
        </button>
        <button className="add" title={t.newSessionIn(space.name)} aria-label={t.newSessionIn(space.name)} onClick={() => draft(space.root)}>
          <Icon svg={ICONS.plus} />
        </button>
        {space.trusted && (
          <button
            className="dots"
            title={t.manage(space.name)}
            aria-label={t.manage(space.name)}
            aria-haspopup="menu"
            aria-expanded={managingFolder}
            onClick={(event) => manageFolder(event.currentTarget)}
          >
            <Icon svg={ICONS.ellipsis} />
          </button>
        )}
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
              beside={beside === summary.id}
              manage={(dots) => manage(dots, { home: space.root, summary })}
              renamed={() => renamed(summary.id)}
            />
          ))}
          {!space.sessions.length && <p className="none">{t.noSessions}</p>}
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
  beside: boolean;
  manage: (dots: HTMLButtonElement) => void;
  renamed: () => void;
}

function SessionRow({ home, summary, renaming, managed, beside, manage, renamed }: RowProps) {
  const current = useStore(project, (s) => !s.view && s.root === home && s.session === summary.id);
  const activity = useStore(rail, (s) => s.activity.get(summary.id));
  const lifted = useStore(drag, (s) => s.phase === "dragging" && s.dragged?.id === summary.id);
  const doing = activity ? t.activity[activity] : "";
  const said = [summary.title, doing, t.messages(summary.tasks), summary.archived ? t.archived : ""];
  return (
    <div
      className="session-row"
      data-session={summary.id}
      data-current={String(current)}
      data-beside={beside ? "true" : undefined}
      data-lifted={lifted ? "true" : undefined}
      data-renaming={renaming ? "true" : undefined}
    >
      {renaming && <Rename home={home} summary={summary} done={renamed} />}
      <button
        className="session"
        aria-current={current}
        title={said.filter(Boolean).join(" · ")}
        onPointerDown={(event) => lift(event, { home, id: summary.id, title: summary.title, folder: stem(home) })}
        onClick={() => resume(home, summary.id)}
      >
        {activity && <ActivityMark activity={activity} />}
        <span className="name">{summary.title}</span>
        {summary.archived && (
          <span className="kept">
            <Icon svg={ICONS.box} />
          </span>
        )}
      </button>
      <button
        className="dots"
        title={t.manageSession}
        aria-label={t.manageSession}
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
      aria-label={t.sessionName}
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

function FolderMenu({ menu, root }: { menu: Sheet; root: string | null }) {
  useLayoutEffect(() => {
    if (menu.open && menu.sheet.ref.current && menu.anchor.current) anchorMenu(menu.sheet.ref.current, menu.anchor.current);
  }, [menu.open, root]);

  async function untrust() {
    if (!root) return;
    menu.shut();
    await distrust(root);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.project[data-root="${CSS.escape(root)}"] .fold`)?.focus());
  }

  return (
    <div className="sheet menu float-menu" id="folder-menu" role="menu" aria-label={t.manageFolder} {...menu.sheet}>
      <button className="menu-item" role="menuitem" tabIndex={-1} onClick={untrust}>
        <span className="act-icon">
          <Icon svg={ICONS.shieldOff} />
        </span>
        <span className="act-text">{t.untrust}</span>
      </button>
    </div>
  );
}

// Deleting asks twice: the first click turns the item into "Confirmar".
function RowMenu({ menu, managed, shown, rename }: { menu: Sheet; managed: Managed | null; shown: string[]; rename: () => void }) {
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
    <div className="sheet menu float-menu" id="session-menu" role="menu" aria-label={t.manageSession} {...menu.sheet}>
      {managed && !shown.includes(managed.summary.id) && (
        <button
          className="menu-item"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            menu.shut();
            openBeside(managed.home, managed.summary.id);
          }}
        >
          <span className="act-icon">
            <Icon svg={ICONS.splitView} />
          </span>
          <span className="act-text">{t.openBeside}</span>
        </button>
      )}
      <button className="menu-item" role="menuitem" tabIndex={-1} onClick={rename}>
        <span className="act-icon">
          <Icon svg={ICONS.pencil} />
        </span>
        <span className="act-text">{t.rename}</span>
      </button>
      <button className="menu-item" role="menuitem" tabIndex={-1} onClick={act((one) => archiveSession(one.home, one.summary))}>
        <span className="act-icon">
          <Icon svg={kept ? ICONS.unarchive : ICONS.archive} />
        </span>
        <span className="act-text">{kept ? t.unarchive : t.archive}</span>
      </button>
      <button
        className="menu-item risky"
        role="menuitem"
        tabIndex={-1}
        data-armed={String(armed)}
        onClick={
          armed
            ? act(async (one) => {
                const shown = await deleteSession(one.home, one.summary.id);
                if (shown) await dropShown(shown, one.home);
              })
            : () => setArmed(true)
        }
      >
        <span className="act-icon">
          <Icon svg={ICONS.trash} />
        </span>
        <span className="act-text">{armed ? t.confirm : t.remove}</span>
      </button>
    </div>
  );
}
