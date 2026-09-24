import { Fragment, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { Detail, Listing } from "../../ipc/types";
import { FRONT_MATTER, MARKDOWN, compact, stem, weigh } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { openOutside } from "../../shared/outside";
import { project } from "../project/store";
import { RunRow, confirmRemoval, installForm, needsAsking } from "./forms";
import { CapSwitch } from "./Installed";
import {
  BADGES,
  DETAIL_TABS,
  FILE_ROWS,
  KIND_NAMES,
  firstLine,
  installedItem,
  originFor,
  specOf,
  type Origin,
} from "./kinds";
import { capabilities, closeDetail, installNow, pickDetailTab, readFile, updateInstalled } from "./store";

export function DetailView({ hidden }: { hidden: boolean }) {
  const detailing = useStore(capabilities, (s) => s.detailing);
  const fault = useStore(capabilities, (s) => s.detailFault);

  let body = null;
  if (detailing?.fault) body = <p className="none fault">{detailing.fault}</p>;
  else if (detailing && !detailing.detail) body = <p className="none">Descargando para mostrártelo…</p>;
  else if (detailing?.detail) body = <Sheet detail={detailing.detail} tab={detailing.tab} />;

  return (
    <div id="caps-detail" hidden={hidden}>
      <button className="quiet detail-back" id="detail-back" onClick={closeDetail}>
        <Icon svg={ICONS.back} />
        Capacidades
      </button>
      <div id="detail-body">
        {fault && (
          <p className="none fault" role="alert">
            {fault}
          </p>
        )}
        {body}
      </div>
    </div>
  );
}

function Sheet({ detail, tab }: { detail: Detail; tab: string }) {
  const listing = detail.listing;
  const meta = [
    listing.author,
    listing.version && `v${listing.version}`,
    detail.license,
    listing.installs && `${compact(listing.installs)} instalaciones`,
  ].filter(Boolean);
  const said = listing.description || firstLine(detail.readme);
  const tabs = DETAIL_TABS.filter(([id]) => id !== "contents" || detail.files.length);
  const at = tabs.some(([id]) => id === tab) ? tab : "summary";

  return (
    <>
      <div className="detail-head">
        <span className="label">{`${KIND_NAMES[listing.kind]} · ${BADGES[listing.badge]}`}</span>
        <h2 className="detail-title">{listing.title}</h2>
        {meta.length > 0 && <p className="detail-meta">{meta.join(" · ")}</p>}
        {said && <p className="detail-said">{said}</p>}
        <Actions detail={detail} />
      </div>
      <div className="view-head">
        <div className="tabs" role="tablist" aria-label="Partes de la ficha">
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

function Actions({ detail }: { detail: Detail }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const installing = useStore(capabilities, (s) => s.installing);
  const listing = detail.listing;
  const origin = originFor(caps, listing.id);

  function start(button: HTMLElement) {
    if (needsAsking(detail)) installForm(detail, button);
    else installNow(detail);
  }

  return (
    <div className="detail-actions">
      {origin ? (
        <Installed listing={listing} origin={origin} />
      ) : (
        <>
          <button
            className="primary"
            disabled={installing || !listing.installable}
            onClick={(event) => start(event.currentTarget)}
          >
            {installing ? "Instalando…" : "Instalar"}
          </button>
          {!listing.installable && (
            <span className="detail-why">
              {listing.login
                ? "Pide iniciar sesión en el servicio; Sens aún no puede hacerlo por ti."
                : "Este origen no se puede instalar desde Sens."}
            </span>
          )}
        </>
      )}
      {listing.homepage && (
        <button className="quiet" title={listing.homepage} onClick={() => openOutside(listing.homepage)}>
          <Icon svg={ICONS.external} />
          Ver fuente
        </button>
      )}
    </div>
  );
}

function Installed({ listing, origin }: { listing: Listing; origin: Origin }) {
  const caps = useStore(capabilities, (s) => s.caps);
  const root = useStore(project, (s) => s.root);
  const [updating, setUpdating] = useState(false);
  const spec = specOf(origin);
  const item = installedItem(caps, origin);

  async function update() {
    setUpdating(true);
    await updateInstalled(listing, origin.name);
  }

  return (
    <>
      {item && (
        <label className="detail-switch">
          <CapSwitch spec={spec} item={item} where="detailFault" />
          {root ? `Activa en ${stem(root)}` : "Abre un proyecto para activarla"}
        </label>
      )}
      {listing.revision && origin.revision !== listing.revision && (
        <button className="quiet" disabled={updating} onClick={update}>
          <Icon svg={ICONS.refresh} />
          Actualizar
        </button>
      )}
      <button className="quiet" onClick={(event) => confirmRemoval(spec, origin.name, event.currentTarget)}>
        Desinstalar
      </button>
    </>
  );
}

function Summary({ detail }: { detail: Detail }) {
  const tools = detail.listing.tools;
  return (
    <div>
      <Markdown text={detail.readme.replace(FRONT_MATTER, "")} />
      {tools.length > 0 && (
        <>
          <p className="label">{`Herramientas · ${tools.length}`}</p>
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
    ["Skills", detail.parts.skills],
    ["Comandos", detail.parts.commands],
    ["Agentes", detail.parts.agents],
  ];
  const fileButton = (group: string, name: string, path: string, sub: string) => (
    <button key={`${group}:${path}`} className="detail-file" data-path={path} aria-current={path === file} onClick={() => readFile(path)}>
      <span>{name}</span>
      {sub && <span className="path">{sub}</span>}
    </button>
  );

  return (
    <div className="detail-split">
      <nav className="detail-nav" aria-label="Ficheros">
        {groups.map(
          ([label, parts]) =>
            parts.length > 0 && (
              <Fragment key={label}>
                <p className="label">{label}</p>
                {parts.map((part) => fileButton(label, part.name, part.path, part.path))}
              </Fragment>
            ),
        )}
        <p className="label">{`Ficheros · ${detail.files.length}`}</p>
        {detail.files.slice(0, FILE_ROWS).map((row) => fileButton("files", row.path, row.path, weigh(row.size)))}
        {detail.files.length > FILE_ROWS && <p className="none">{`y ${detail.files.length - FILE_ROWS} más`}</p>}
      </nav>
      <div className="detail-reader">
        {!reading ? (
          <p className="none">Elige un fichero para leerlo.</p>
        ) : reading.fault ? (
          <p className="none fault">{reading.fault}</p>
        ) : reading.text === null ? (
          <p className="none">Leyendo…</p>
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
    ["Hooks", detail.parts.hooks.map((hook) => [hook.event, hook.command])],
    ["Servidores MCP", detail.parts.servers.map((server) => [server.name, server.launch])],
    ["Ejecutables", detail.parts.bin.map((path) => [path, ""])],
    ["LSP", detail.parts.lsp.map((name) => [name, ""])],
    [
      "Lo que te pedirá",
      detail.needs.map((need) => [need.name, [need.description, need.required ? "" : "opcional"].filter(Boolean).join(" · ")]),
    ],
    ["Inicio de sesión", detail.listing.login ? [["Pide iniciar sesión en el servicio", ""]] : []],
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
        <p className="none">No ejecuta código: solo instrucciones.</p>
      )}
    </div>
  );
}
