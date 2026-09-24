import "./styles.css";
import "./legacy/app.js";
import { mountShelf } from "./features/artifacts/Shelf";
import { mountCapabilities } from "./features/capabilities/Capabilities";
import { mountChanges } from "./features/changes/Changes";
import { mountTree } from "./features/files/Tree";
import { mountSettings } from "./features/settings/Settings";
import { mountTasks } from "./features/tasks/TasksPanel";

const byId = (id: string) => document.getElementById(id)!;

// Each zone React owns is mounted here; app.js no longer touches its nodes.
mountShelf(byId("shelf-body"));
mountCapabilities(byId("capabilities-body"));
mountSettings(byId("settings-body"));
mountChanges(byId("changes"), byId("change-marks"));
mountTree(byId("tree"));
mountTasks(byId("tasks"), byId("task-tally"));
