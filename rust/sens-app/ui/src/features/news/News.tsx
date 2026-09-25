import { useStore } from "zustand";
import type { News } from "../../ipc/types";
import { plural } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { openOutside } from "../../shared/outside";
import { updates } from "../updates/store";
import { closeNews, loadNews, news } from "./store";

const RELEASES = "https://github.com/iiTzSenn/Sens/releases";

function day(published: string) {
  const at = new Date(published);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}

function lead(told: News[] | null) {
  if (!told?.length) return "Lo que trae cada versión de Sens.";
  const [newest, ...before] = told;
  if (!before.length) return `Lo que trae Sens ${newest.version}.`;
  return `Lo que trae Sens ${newest.version}, y ${plural(before.length, "versión anterior", "versiones anteriores")} que no habías visto.`;
}

export function NewsView() {
  const told = useStore(news, (s) => s.told);
  const loading = useStore(news, (s) => s.loading);
  const fault = useStore(news, (s) => s.fault);
  const current = useStore(updates, (s) => s.current);
  return (
    <>
      <header className="view-top news-top">
        <div>
          <h1 className="label">Novedades</h1>
          <p>{lead(told)}</p>
        </div>
        <button className="icon-btn" id="news-close" title="Cerrar" aria-label="Cerrar novedades" onClick={closeNews}>
          <Icon svg={ICONS.dismiss} />
        </button>
      </header>
      {loading && (
        <p className="news-state" role="status">
          Leyendo las notas de GitHub…
        </p>
      )}
      {fault && !loading && (
        <div className="news-state">
          <p className="fault" role="alert">
            {fault}
          </p>
          <div className="news-actions">
            <button className="quiet" onClick={loadNews}>
              Reintentar
            </button>
            <button className="quiet" onClick={() => openOutside(RELEASES)}>
              <Icon svg={ICONS.external} />
              <span>Ver en GitHub</span>
            </button>
          </div>
        </div>
      )}
      {told?.length === 0 && <p className="news-state">{current ? `Sens ${current} todavía no tiene notas publicadas.` : "Esta versión todavía no tiene notas publicadas."}</p>}
      {told?.map((one) => <Version key={one.version} one={one} installed={one.version === current} />)}
      {Boolean(told?.length) && (
        <footer className="news-foot">
          <button className="primary" onClick={closeNews}>
            Continuar
          </button>
        </footer>
      )}
    </>
  );
}

function Version({ one, installed }: { one: News; installed: boolean }) {
  const heading = `news-${one.version.replaceAll(".", "-")}`;
  const when = day(one.published);
  return (
    <article className="news-release" aria-labelledby={heading}>
      <p className="news-meta">
        <span className="news-version">{one.version}</span>
        {installed && <span className="news-now">Instalada</span>}
        {when && <time dateTime={one.published}>{when}</time>}
        <button className="news-link" onClick={() => openOutside(one.page)}>
          <span>Ver en GitHub</span>
          <Icon svg={ICONS.external} />
        </button>
      </p>
      <h2 id={heading}>{one.title || `Sens ${one.version}`}</h2>
      {one.notes ? <Markdown className="news-notes" text={one.notes} /> : <p className="news-none">Esta versión no trae notas.</p>}
    </article>
  );
}
