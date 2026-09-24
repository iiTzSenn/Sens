import "./setup.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Setup } from "./Setup";
import { boot } from "./store";

createRoot(document.getElementById("setup")!).render(createElement(StrictMode, null, createElement(Setup)));

boot().then(() =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.body.classList.remove("still");
      getCurrentWindow().show();
    }),
  ),
);
