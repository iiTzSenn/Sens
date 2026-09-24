import "./styles.css";
import "./legacy/app.js";
import { mountSettings } from "./features/settings/Settings";

// Each zone React owns is mounted here; app.js no longer touches its nodes.
mountSettings(document.getElementById("settings-body")!);
