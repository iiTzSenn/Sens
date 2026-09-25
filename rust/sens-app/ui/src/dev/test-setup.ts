import { showLanguage } from "../shared/i18n";

if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = () => null;

showLanguage("es");
