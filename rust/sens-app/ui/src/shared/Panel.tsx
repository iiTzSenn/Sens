import { StrictMode, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { legacy } from "../legacy/bridge";

// React content in the shared dialog app.js owns. It renders before the dialog
// opens, so the field marked data-autofocus takes the focus, and it unmounts
// when the dialog closes.
export function openPanel(title: string, content: ReactElement, back?: HTMLElement) {
  const host = document.createElement("div");
  host.style.display = "contents";
  const root = createRoot(host);
  flushSync(() => root.render(<StrictMode>{content}</StrictMode>));
  legacy.showPanel(title, host, back);
  host.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  document.getElementById("panel")?.addEventListener("close", () => root.unmount(), { once: true });
}

export type Control = {
  id: string;
  autoComplete: "off";
  spellCheck: false;
  "aria-describedby"?: string;
};

export function Pair({ id, label, note, control }: { id: string; label: string; note?: string; control: (props: Control) => ReactNode }) {
  const hint = note ? `${id}-note` : undefined;
  return (
    <div className="pair">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {control({ id, autoComplete: "off", spellCheck: false, "aria-describedby": hint })}
      {note && (
        <p className="note" id={hint}>
          {note}
        </p>
      )}
    </div>
  );
}

// The dialog's form: it closes once `act` succeeds, then runs `after`, and it
// stays open saying why when `act` fails.
export function PanelForm({
  submit,
  danger = false,
  act,
  after,
  children,
}: {
  submit: string;
  danger?: boolean;
  act: () => Promise<unknown>;
  after?: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await act();
      legacy.closePanel();
      await after?.();
    } catch (reason) {
      setFault(String(reason));
    }
    setBusy(false);
  }

  return (
    <form className="form" onSubmit={send}>
      {children}
      <p className="none fault" role="alert" hidden={!fault}>
        {fault}
      </p>
      <div className="actions">
        <button type="submit" className={danger ? "primary danger" : "primary"} disabled={busy}>
          {submit}
        </button>
      </div>
    </form>
  );
}
