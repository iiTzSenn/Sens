import { useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { closeDialog, openDialog } from "../app/modal";

// A form or a panel in the shared dialog; `back` takes the focus when it closes.
export const openPanel = (title: string, content: ReactElement, back?: HTMLElement) => openDialog(title, content, back);

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
      closeDialog();
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
