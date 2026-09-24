import "./styles.css";
import "./legacy/app.js";
import { mountShelf } from "./features/artifacts/Shelf";
import { mountCapabilities } from "./features/capabilities/Capabilities";
import { mountChanges } from "./features/changes/Changes";
import { mountThread } from "./features/chat/Thread";
import { mountComposer } from "./features/composer/Composer";
import { mountTree } from "./features/files/Tree";
import { mountViewer } from "./features/files/Viewer";
import { mountRail } from "./features/rail/Rail";
import { mountSettings } from "./features/settings/Settings";
import { mountTasks } from "./features/tasks/TasksPanel";
import { mountWeb } from "./features/web/Web";

const byId = (id: string) => document.getElementById(id)!;

// Each zone React owns is mounted here; app.js no longer touches its nodes.
mountRail(byId("rail"));
mountThread(byId("chat-thread"));
mountComposer(byId("composer"));
mountShelf(byId("shelf-body"));
mountCapabilities(byId("capabilities-body"));
mountSettings(byId("settings-body"));
mountChanges(byId("changes"), byId("change-marks"));
mountTree(byId("tree"));
mountViewer(byId("viewer"), byId("viewer-head"), byId("viewer-modes"));
mountTasks(byId("tasks"), byId("task-tally"));
mountWeb(byId("site"), byId("web-address"), byId("web-out"));
