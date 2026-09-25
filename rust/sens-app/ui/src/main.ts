import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { boot } from "./app/session";
import { watchWidth, whenShown } from "./app/shell";
import { loadChanges } from "./features/changes/store";
import { hearChat } from "./features/chat/store";
import { hearDrops } from "./features/composer/store";
import { loadCatalog } from "./features/models/store";
import { newsAtStart } from "./features/news/store";
import { loadProfile } from "./features/profile/store";
import { tickTasks } from "./features/tasks/store";
import { startUpdates } from "./features/updates/store";
import { greetAtStart, greetIfNew } from "./features/welcome/store";
import { enterSite, hearBrowser } from "./features/web/store";
import { followLook, lookOf, showLook } from "./shared/look";

showLook(lookOf(window.__SENS_LOOK__));
followLook();
greetAtStart();
newsAtStart();

// Once: what Rust tells (the chat, the browser, dropped files), what each tool
// reads as it comes on screen, the window, and then the last project.
hearChat();
hearBrowser();
hearDrops();
watchWidth();
whenShown("changes", loadChanges);
whenShown("web", enterSite);
whenShown("tasks", tickTasks);

createRoot(document.getElementById("app")!).render(createElement(StrictMode, null, createElement(App)));
requestAnimationFrame(() => requestAnimationFrame(() => getCurrentWindow().show()));

loadCatalog();
loadProfile().then(() => {
  startUpdates();
  greetIfNew();
});
boot();
