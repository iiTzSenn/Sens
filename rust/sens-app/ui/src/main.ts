import "./styles.css";
import { StrictMode, createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { boot } from "./app/session";
import { watchWidth, whenShown } from "./app/shell";
import { loadChanges } from "./features/changes/store";
import { hearChat } from "./features/chat/store";
import { hearDrops } from "./features/composer/store";
import { loadCatalog } from "./features/models/store";
import { loadProfile } from "./features/profile/store";
import { tickTasks } from "./features/tasks/store";
import { startUpdates } from "./features/updates/store";
import { enterSite, hearBrowser } from "./features/web/store";

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

loadCatalog();
loadProfile().then(startUpdates);
boot();
