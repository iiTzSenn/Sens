import "./setup.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { FIRST_LOOK, followLook, showLook } from "../shared/look";
import { Setup } from "./Setup";
import { boot } from "./store";

showLook(FIRST_LOOK);
followLook();

createRoot(document.getElementById("setup")!).render(createElement(StrictMode, null, createElement(Setup)));

boot().then(() =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.body.classList.remove("still");
      getCurrentWindow().show();
    }),
  ),
);
