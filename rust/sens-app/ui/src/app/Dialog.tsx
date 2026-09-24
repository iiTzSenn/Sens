import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { Icon } from "../shared/Icon";
import { ICONS } from "../shared/icons.js";
import { closeDialog, closed, dialog, openDialog } from "./modal";

// A picture, as large as the window lets it.
export const openPicture = (title: string, src: string, from: HTMLElement) =>
  openDialog(title, <img className="sight" alt={title} src={src} />, from, true);

// The dialog is modal: its content renders before it opens, so the field
// marked data-autofocus takes the focus. A click on the backdrop closes it.
export function Dialog() {
  const open = useStore(dialog, (s) => s.open);
  const title = useStore(dialog, (s) => s.title);
  const content = useStore(dialog, (s) => s.content);
  const wide = useStore(dialog, (s) => s.wide);
  const box = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const shown = box.current;
    if (!shown) return;
    if (open && !shown.open) {
      shown.showModal();
      shown.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && shown.open) shown.close();
  }, [open]);

  return (
    <dialog
      className="panel"
      id="panel"
      aria-labelledby="panel-title"
      data-wide={String(wide)}
      ref={box}
      onClose={closed}
      onClick={(event) => event.target === box.current && closeDialog()}
    >
      <div className="panel-head">
        <h2 id="panel-title">{title}</h2>
        <button className="icon-btn" id="panel-close" title="Cerrar" aria-label="Cerrar" onClick={closeDialog}>
          <Icon svg={ICONS.dismiss} />
        </button>
      </div>
      <div className="panel-body" id="panel-body">
        {content}
      </div>
    </dialog>
  );
}
