import "./styles.css";
import "./legacy/app.js";
import { mountCapabilities } from "./features/capabilities/Capabilities";
import { mountSettings } from "./features/settings/Settings";

// Each zone React owns is mounted here; app.js no longer touches its nodes.
mountCapabilities(document.getElementById("capabilities-body")!);
mountSettings(document.getElementById("settings-body")!);
