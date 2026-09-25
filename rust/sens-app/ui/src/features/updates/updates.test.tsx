// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../../app/Dialog";
import { dialog } from "../../app/modal";
import { showLanguage } from "../../shared/i18n";
import { updates, updateState } from "./store";
import { openUpdate } from "./UpdatePanel";

vi.mock("../../ipc/commands", () => ({ commands: { chatWorking: vi.fn(async () => 0), updateInstall: vi.fn(), openExternal: vi.fn() }, events: {} }));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
});

beforeEach(() => {
  updates.setState(updates.getInitialState(), true);
  dialog.setState(dialog.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  showLanguage("es");
});

const latest = { version: "0.22.0", notes: "", page: "https://github.com/iiTzSenn/Sens/releases/tag/v0.22.0", size: 0 };

describe("updates", () => {
  it("say where the check is", () => {
    const state = updates.getState();
    expect(updateState({ ...state, checking: true })).toBe("Comprobando…");
    expect(updateState({ ...state, latest })).toBe("Sens 0.22.0 disponible.");
    expect(updateState({ ...state, checked: true })).toBe("Estás en la última versión.");
  });

  it("speak the language chosen", () => {
    showLanguage("en");
    expect(updateState({ ...updates.getState(), checked: true })).toBe("You’re on the latest version.");
    updates.setState({ current: "0.21.0", latest, installable: false });
    render(<Dialog />);
    act(() => openUpdate(document.body));
    expect(document.querySelector("#panel-body .note")?.textContent).toMatch(/^You’re on 0\.21\.0 · /);
    expect(screen.getByText("This version has no release notes.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Development build: it checks for updates but doesn’t install them.");
    expect(screen.getByRole("button", { name: "Update and restart" })).toHaveProperty("disabled", true);
  });
});
