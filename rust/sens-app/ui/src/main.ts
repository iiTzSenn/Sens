import "./styles.css";
import "./legacy/app.js";
import { mountShelf } from "./features/artifacts/Shelf";
import { mountCapabilities } from "./features/capabilities/Capabilities";
import { mountSettings } from "./features/settings/Settings";

// Each zone React owns is mounted here; app.js no longer touches its nodes.
mountShelf(document.getElementById("shelf-body")!);
mountCapabilities(document.getElementById("capabilities-body")!);
mountSettings(document.getElementById("settings-body")!);
