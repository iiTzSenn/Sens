import { useState } from "react";
import { useStore } from "zustand";
import { commands } from "../../ipc/commands";
import { legacy } from "../../legacy/bridge";
import { weigh } from "../../shared/format.js";
import { Icon } from "../../shared/Icon";
import { ICONS } from "../../shared/icons.js";
import { Markdown } from "../../shared/markdown/Markdown";
import { openPanel } from "../../shared/Panel";
import { updates } from "./store";

const STAGES = {
  downloading: "Descargando…",
  verifying: "Verificando la firma…",
  installing: "Instalando: Sens se cerrará y volverá a abrirse",
};

// The new version, its notes, and installing it: Sens restarts at the end.
export function openUpdate(back: HTMLElement) {
  const { latest } = updates.getState();
  if (latest) openPanel(`Sens ${latest.version}`, <UpdatePanel />, back);
}

// Sessions still working would be stopped: the first press says so, and
// asks again.
function UpdatePanel() {
  const current = useStore(updates, (s) => s.current);
  const latest = useStore(updates, (s) => s.latest);
  const installable = useStore(updates, (s) => s.installable);
  const stage = useStore(updates, (s) => s.stage);
  const [said, setSaid] = useState({ text: installable ? "" : "Build de desarrollo: comprueba pero no instala.", failed: false });
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);
  if (!latest) return null;

  async function install() {
    if (!sure) {
      const working = await commands.chatWorking().catch(() => 0);
      if (working > 0) {
        setSure(true);
        setSaid({ text: working === 1 ? "Hay 1 sesión trabajando y se detendrá." : `Hay ${working} sesiones trabajando y se detendrán.`, failed: false });
        return;
      }
    }
    setBusy(true);
    setSaid({ text: STAGES.downloading, failed: false });
    try {
      await commands.updateInstall();
    } catch (reason) {
      setSaid({ text: String(reason), failed: true });
      setSure(false);
      setAgain(true);
      setBusy(false);
    }
  }

  const status = busy && stage ? STAGES[stage] : said.text;
  return (
    <>
      <p className="note">{[current && `Tienes la ${current}`, weigh(latest.size)].filter(Boolean).join(" · ")}</p>
      {latest.notes.trim() ? <Markdown className="update-notes" text={latest.notes} /> : <p className="note update-notes">Esta versión no trae notas.</p>}
      <p className={said.failed ? "note fault" : "note"} id="update-status" role="status" hidden={!status}>
        {status}
      </p>
      <div className="actions update-actions">
        <button className="quiet" onClick={() => commands.openExternal(latest.page).catch((reason) => setSaid({ text: String(reason), failed: true }))}>
          <Icon svg={ICONS.external} />
          <span>Ver en GitHub</span>
        </button>
        <button className="quiet" onClick={() => legacy.closePanel()}>
          Más tarde
        </button>
        <button className={sure ? "primary danger" : "primary"} disabled={!installable || busy} onClick={install}>
          {sure ? "Actualizar igualmente" : again ? "Reintentar" : "Actualizar y reiniciar"}
        </button>
      </div>
    </>
  );
}
