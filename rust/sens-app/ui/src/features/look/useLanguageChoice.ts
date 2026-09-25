import { useState } from "react";
import { useStore } from "zustand";
import { commands } from "../../ipc/commands";
import { language, showLanguage, type Language } from "../../shared/i18n";

export async function chooseLanguage(chosen: Language) {
  await commands.setLanguage(chosen);
  showLanguage(chosen);
}

export function useLanguageChoice() {
  const current = useStore(language, (s) => s.current);
  const [saving, setSaving] = useState(false);
  const [fault, setFault] = useState("");

  async function choose(next: Language) {
    if (saving) return;
    setSaving(true);
    setFault("");
    try {
      await chooseLanguage(next);
    } catch (reason) {
      setFault(String(reason));
    }
    setSaving(false);
  }

  return { current, fault, choose };
}
