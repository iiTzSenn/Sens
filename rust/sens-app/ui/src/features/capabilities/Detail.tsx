import { Fragment, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { Detail, Listing } from "../../ipc/types";
import { FRONT_MATTER, MARKDOWN, compact, stem, weigh } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { openOutside } from "../../shared/outside";
import { project } from "../project/store";
import { t } from "./copy";
import { Trust } from "./Explore";
import { ListingFace } from "./Face";
import { RunRow, confirmRemoval, installForm, needsAsking } from "./forms";
import { CapSwitch } from "./Installed";
import { FILE_ROWS, detailTabs, firstLine, installedItem, kindName, originFor, specOf, type DetailTab, type Origin } from "./kinds";
import { SECTION_ICONS, sectionOf } from "./sections";
import { capabilities, closeDetail, installNow, pickDetailTab, pickPlace, readFile, showMode, updateInstalled } from "./store";

export function DetailView({ hidden }: { hidden: boolean }) {
  const detailing = useStore(capabilities, (s) => s.detailing);
  const fault = useStore(capabilities, (s) => s.detailFault);
  const listing = detailing?.detail?.listing || detailing?.listing || null;

  return (
    <div id="caps-detail" hidden={hidden}>
      <button className="quiet detail-back" id="detail-back" onClick={closeDetail}>
        <Icon svg={ICONS.back} />
        {detailing?.back.mode === "installed" ? t.installedMode : t.exploreMode}
      </button>
      <div id="detail-body">
        {fault && (
          <p className="none fault" role="alert">
            {fault}
          </p>
        )}
        {listing && <Head listing={listing} detail={detailing?.detail || null} />}
        {detailing?.fault ? (
          <p className="none fault">{detailing.fault}</p>
        ) : detailing && !detailing.detail ? (
          <p className="none">{t.downloading}</p>
        ) : detailing?.detail ? (
          <Sheet detail={detailing.detail} tab={detailing.tab} />
        ) : null}
      </div>
    </div>
  );
}

function Head({ listing, detail }: { listing: Listing; detail: Detail | null }) {
  const section = sectionOf(listing);
  const meta = [
    listing.kind !== "connector" && listing.author,
    listing.version && `v${listing.version}`,
    detail?.license,
    listing.installs && t.installs(compact(listing.installs)),
  ].filter(Boolean);
  const said = listing.description || (detail ? firstLine(detail.readme) : "");
  return (
    <div className="dt-head">
      <div className="dt-id">
        <ListingFace listing={listing} big />
        <div className="dt-names">
          <span className="dt-kicker">
            {kindName(listing.kind)}
            <span aria-hidden="true">·</span>
            <button
              className="dt-section"
              onClick={() => {
                showMode("explore");
                pickPlace(section);
              }}
            >
              <Icon svg={SECTION_ICONS[section]} />
              {t.sectionNames[section]}
            </button>
          </span>
          <h2 className="detail-title">{listing.title}</h2>
          <p className="detail-meta">
            <Trust badge={listing.badge} />
            {meta.map((part) => (
              <span key={String(part)}>{part}</span>
            ))}
          </p>
        </div>
      </div>
      {said && <p className="detail-said">{said}</p>}
      {detail && <Actions detail={detail} />}
      {detail && <Journey detail={detail} />}
      {detail && <RunsLine detail={detail} />}
    </div>
  );
}

function Actions({ detail }: { detail: Detail }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const installing = useStore(capabilities, (s) => s.installing);
  const root = useStore(project, (s) => s.root);
  const listing = detail.listing;
  const origin = originFor(caps, listing.id);

  function start(button: HTMLElement) {
    if (needsAsking(detail)) installForm(detail, button);
    else installNow(detail);
  }

  return (
    <div className="detail-actions">
      {origin ? (
        <InstalledActions listing={listing} origin={origin} />
      ) : (
        <>
          <button className="primary" disabled={installing || !listing.installable} onClick={(event) => start(event.currentTarget)}>
            {installing ? t.installing : root ? t.addHere(stem(root)) : t.install}
          </button>
          {!listing.installable && <span className="detail-why">{listing.login ? t.whyLogin : t.whyOrigin}</span>}
        </>
      )}
      {listing.homepage && (
        <button className="quiet" title={listing.homepage} onClick={() => openOutside(listing.homepage)}>
          <Icon svg={ICONS.external} />
          {t.viewSource}
        </button>
      )}
    </div>
  );
}

function InstalledActions({ listing, origin }: { listing: Listing; origin: Origin }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const root = useStore(project, (s) => s.root);
  const [updating, setUpdating] = useState(false);
  const spec = specOf(origin);
  const item = installedItem(caps, origin);

  async function update() {
    setUpdating(true);
    await updateInstalled(listing, origin.name);
    setUpdating(false);
  }

  return (
    <>
      {item && (
        <label className="detail-switch">
          <CapSwitch spec={spec} item={item} where="detailFault" />
          {root ? t.enabledIn(stem(root)) : t.openToEnable}
        </label>
      )}
      {listing.revision && origin.revision !== listing.revision && (
        <button className="quiet" disabled={updating} onClick={update}>
          <Icon svg={ICONS.refresh} />
          {t.update}
        </button>
      )}
      <button className="quiet" onClick={(event) => confirmRemoval(spec, origin.name, event.currentTarget)}>
        {t.uninstall}
      </button>
    </>
  );
}

function Journey({ detail }: { detail: Detail }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const root = useStore(project, (s) => s.root);
  if (!detail.listing.installable && !originFor(caps, detail.listing.id)) return null;
  const origin = originFor(caps, detail.listing.id);
  const item = origin ? installedItem(caps, origin) : null;
  const on = Boolean(item?.enabled && root);
  const steps: [boolean, string, string][] = [
    [Boolean(origin), t.jInstall, origin ? t.jInstalled(origin.version) : t.jNotInstalled],
    [on, root ? t.jEnable(stem(root)) : t.jEnableAny, !root ? t.jNoProject : on ? t.jEnabled : t.jOff],
    [on, t.jUse, on ? t.jUsing : t.jWaiting],
  ];
  return (
    <ol className="dt-journey" aria-label={t.journey}>
      {steps.map(([done, title, state], at) => (
        <li key={at} data-done={done}>
          <span className="dt-step">{done ? <Icon svg={ICONS.done} /> : at + 1}</span>
          <span className="dt-step-text">
            <b>{title}</b>
            <span>{state}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function RunsLine({ detail }: { detail: Detail }) {
  const { hooks, servers, bin, lsp } = detail.parts;
  const local = detail.listing.kind !== "connector" && hooks.length + servers.length + bin.length + lsp.length > 0;
  const remote = detail.listing.kind === "connector";
  const [icon, said]: [string, string] = local
    ? [ICONS.shieldAlert, t.runsLocal(hooks.length, servers.length, bin.length, lsp.length)]
    : remote
      ? [ICONS.server, detail.listing.author ? t.runsRemoteAt(detail.listing.author) : t.runsRemote]
      : [ICONS.shieldCheck, t.noCode];
  return (
    <p className="dt-runs" data-local={local}>
      <Icon svg={icon} />
      <span>{said}</span>
      {(local || remote) && (
        <button className="link-btn" onClick={() => pickDetailTab("runs")}>
          {t.seeRuns}
        </button>
      )}
    </p>
  );
}

function Sheet({ detail, tab }: { detail: Detail; tab: DetailTab }) {
  const tabs = detailTabs().filter(([id]) => id !== "contents" || detail.files.length);
  const at = tabs.some(([id]) => id === tab) ? tab : "summary";

  return (
    <>
      <div className="view-head">
        <div className="tabs" role="tablist" aria-label={t.detailTabs}>
          {tabs.map(([id, label]) => (
            <button key={id} className="tab" role="tab" aria-selected={id === at} onClick={() => pickDetailTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="detail-pane" role="tabpanel">
        {at === "summary" && <Summary detail={detail} />}
        {at === "contents" && <Contents detail={detail} />}
        {at === "runs" && <Runs detail={detail} />}
      </div>
    </>
  );
}

function Summary({ detail }: { detail: Detail }) {
  const tools = detail.listing.tools;
  return (
    <div className="dt-summary">
      <Markdown text={detail.readme.replace(FRONT_MATTER, "")} />
      {tools.length > 0 && (
        <>
          <p className="label">{t.toolsTitle(tools.length)}</p>
          <div className="tool-chips">
            {tools.map((name) => (
              <code key={name}>{name}</code>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Contents({ detail }: { detail: Detail }) {
  const file = useStore(capabilities, (s) => s.detailing?.file ?? "");
  const reading = useStore(capabilities, (s) => s.detailing?.reading ?? null);
  const first =
    file ||
    detail.parts.skills[0]?.path ||
    detail.parts.commands[0]?.path ||
    detail.files.find((row) => MARKDOWN.test(row.path))?.path ||
    "";

  useEffect(() => {
    if (first && reading?.path !== first) readFile(first);
  }, [first]);

  const groups: [string, typeof detail.parts.skills][] = [
    [t.skillsGroup, detail.parts.skills],
    [t.commandsGroup, detail.parts.commands],
    [t.agentsGroup, detail.parts.agents],
  ];
  const fileButton = (group: string, name: string, path: string, sub: string) => (
    <button key={`${group}:${path}`} className="detail-file" data-path={path} aria-current={path === file} onClick={() => readFile(path)}>
      <span>{name}</span>
      {sub && <span className="path">{sub}</span>}
    </button>
  );

  return (
    <div className="detail-split">
      <nav className="detail-nav" aria-label={t.filesNav}>
        {groups.map(
          ([label, parts]) =>
            parts.length > 0 && (
              <Fragment key={label}>
                <p className="label">{label}</p>
                {parts.map((part) => fileButton(label, part.name, part.path, part.path))}
              </Fragment>
            ),
        )}
        <p className="label">{t.filesGroup(detail.files.length)}</p>
        {detail.files.slice(0, FILE_ROWS).map((row) => fileButton("files", row.path, row.path, weigh(row.size)))}
        {detail.files.length > FILE_ROWS && <p className="none">{t.andMore(detail.files.length - FILE_ROWS)}</p>}
      </nav>
      <div className="detail-reader">
        {!reading ? (
          <p className="none">{t.pickFile}</p>
        ) : reading.fault ? (
          <p className="none fault">{reading.fault}</p>
        ) : reading.text === null ? (
          <p className="none">{t.reading}</p>
        ) : MARKDOWN.test(reading.path) ? (
          <Markdown text={reading.text.replace(FRONT_MATTER, "")} />
        ) : (
          <pre>{reading.text}</pre>
        )}
      </div>
    </div>
  );
}

function Runs({ detail }: { detail: Detail }) {
  const sections: [string, [string, string][]][] = [
    [t.hooks, detail.parts.hooks.map((hook) => [hook.event, hook.command])],
    [t.servers, detail.parts.servers.map((server) => [server.name, server.launch])],
    [t.executables, detail.parts.bin.map((path) => [path, ""])],
    [t.lsp, detail.parts.lsp.map((name) => [name, ""])],
    [t.asks, detail.needs.map((need) => [need.name, [need.description, need.required ? "" : t.optional].filter(Boolean).join(" · ")])],
    [t.signingIn, detail.listing.login ? [[t.asksSignIn, ""]] : []],
  ];
  const shown = sections.filter(([, rows]) => rows.length);
  return (
    <div className="detail-runs">
      {shown.length ? (
        shown.map(([label, rows]) => (
          <Fragment key={label}>
            <p className="label">{label}</p>
            {rows.map(([name, code], at) => (
              <RunRow key={at} name={name} code={code} />
            ))}
          </Fragment>
        ))
      ) : (
        <p className="none">{t.noCode}</p>
      )}
    </div>
  );
}
