import "./setup.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { languageOf, showLanguage } from "../shared/i18n";
import { FIRST_LOOK, followLook, showLook } from "../shared/look";
import { Installer } from "./Setup";
import { boot } from "./store";

showLanguage(languageOf(window.__SENS_LANGUAGE__));
showLook(FIRST_LOOK);
followLook();

createRoot(document.getElementById("setup")!).render(createElement(StrictMode, null, createElement(Installer)));

boot().then(() =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.body.classList.remove("still");
      getCurrentWindow().show();
    }),
  ),
);
